<?php
/**
 * Plugin Name: Cloudflare Pages Deploy Hook
 * Description: Triggers a Cloudflare Pages build when a WordPress post's published content changes.
 * Version: 1.3.0
 * Requires PHP: 7.4
 * Requires at least: 5.6
 * License: GPL-2.0-or-later
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class Cloudflare_Pages_Deploy_Hook {
	private const URL_OPTION = 'cloudflare_pages_deploy_hook_url';
	private const EVENTS_OPTION = 'cloudflare_pages_deploy_hook_events';
	private const LOG_OPTION = 'cloudflare_pages_deploy_hook_log';
	private const PENDING_OPTION = 'cloudflare_pages_deploy_hook_pending';
	private const CRON_HOOK = 'cloudflare_pages_deploy_hook_run';
	private const COALESCE_SECONDS = 20;
	private const MAX_LOG_ENTRIES = 20;
	private const EVENTS = array( 'create', 'update', 'delete', 'trash', 'unpublish' );
	private const DEFAULT_EVENTS = array( 'create', 'update', 'trash', 'unpublish' );

	private static $pending = null;
	private static $deleting_published_posts = array();

	public static function init() {
		add_action( 'wp_after_insert_post', array( __CLASS__, 'on_post_saved' ), 10, 4 );
		add_action( 'before_delete_post', array( __CLASS__, 'before_post_deleted' ), 10, 2 );
		add_action( 'deleted_post', array( __CLASS__, 'on_post_deleted' ) );
		add_action( 'shutdown', array( __CLASS__, 'deploy_pending' ) );
		add_action( self::CRON_HOOK, array( __CLASS__, 'run_scheduled_deploy' ) );
		add_action( 'admin_menu', array( __CLASS__, 'register_admin_page' ) );
		add_action( 'admin_post_cloudflare_pages_save_settings', array( __CLASS__, 'save_settings' ) );
		add_action( 'admin_post_cloudflare_pages_retry_deploy', array( __CLASS__, 'retry_deploy' ) );
	}

	public static function on_post_saved( $post_id, $post, $update, $post_before ) {
		if ( 'post' !== $post->post_type || wp_is_post_revision( $post_id ) || wp_is_post_autosave( $post_id ) ) {
			return;
		}

		if ( defined( 'DOING_AUTOSAVE' ) && DOING_AUTOSAVE ) {
			return;
		}

		$old_status = $post_before ? $post_before->post_status : 'new';
		$new_status = $post->post_status;

		if ( 'publish' === $new_status ) {
			$event = 'publish' === $old_status ? 'update' : 'create';
		} elseif ( 'publish' === $old_status ) {
			$event = 'trash' === $new_status ? 'trash' : 'unpublish';
		} else {
			return;
		}

		self::queue_event( $event, $post_id );
	}

	public static function before_post_deleted( $post_id, $post ) {
		if ( 'post' !== $post->post_type ) {
			return;
		}

		$previous_status = 'trash' === $post->post_status ? get_post_meta( $post_id, '_wp_trash_meta_status', true ) : $post->post_status;
		if ( 'publish' === $previous_status ) {
			self::$deleting_published_posts[ $post_id ] = true;
		}
	}

	public static function on_post_deleted( $post_id ) {
		if ( ! isset( self::$deleting_published_posts[ $post_id ] ) ) {
			return;
		}

		unset( self::$deleting_published_posts[ $post_id ] );
		self::queue_event( 'delete', $post_id );
	}

	private static function queue_event( $event, $post_id ) {
		if ( ! self::event_enabled( $event ) ) {
			return;
		}

		// One request can save a post more than once. A Pages build covers all changes in it.
		self::$pending = array( 'post_id' => (int) $post_id, 'event' => $event );
	}

	private static function enabled_events() {
		$events = get_option( self::EVENTS_OPTION, self::DEFAULT_EVENTS );
		return is_array( $events ) ? $events : self::DEFAULT_EVENTS;
	}

	private static function event_enabled( $event ) {
		if ( 'publish' === $event ) {
			$event = 'create';
		}

		return in_array( $event, self::enabled_events(), true );
	}

	public static function deploy_pending() {
		if ( null === self::$pending ) {
			return;
		}

		$pending       = self::$pending;
		self::$pending = null;
		$queued        = get_option( self::PENDING_OPTION, array() );
		$due           = is_array( $queued ) && isset( $queued['due'] ) ? (int) $queued['due'] : time() + self::COALESCE_SECONDS;

		// Separate editor requests share the first request's scheduled build.
		update_option(
			self::PENDING_OPTION,
			array( 'due' => $due, 'event' => $pending['event'], 'post_id' => $pending['post_id'] ),
			false
		);

		if ( ! wp_next_scheduled( self::CRON_HOOK ) && ! wp_schedule_single_event( $due, self::CRON_HOOK ) ) {
			self::log_attempt( $pending['event'], $pending['post_id'], 'Could not schedule deployment; retry manually.' );
		}
	}

	public static function run_scheduled_deploy() {
		$pending = get_option( self::PENDING_OPTION, array() );
		if ( ! is_array( $pending ) || ! isset( $pending['event'], $pending['post_id'] ) ) {
			return;
		}

		delete_option( self::PENDING_OPTION );
		if ( self::event_enabled( $pending['event'] ) ) {
			self::send_deploy_hook( $pending['event'], (int) $pending['post_id'] );
		}
	}

	private static function send_deploy_hook( $event, $post_id ) {
		$url = get_option( self::URL_OPTION, '' );

		if ( ! is_string( $url ) || '' === $url ) {
			$error = 'Deploy Hook URL is not configured.';
		} elseif ( 'https' !== wp_parse_url( $url, PHP_URL_SCHEME ) ) {
			$error = 'Deploy Hook URL must use HTTPS.';
		} else {
			$response = wp_safe_remote_post(
				$url,
				array(
					'timeout'     => 10,
					'redirection' => 0,
				)
			);

			if ( is_wp_error( $response ) ) {
				$error = 'Request failed: ' . sanitize_key( $response->get_error_code() );
			} else {
				$status = wp_remote_retrieve_response_code( $response );
				$error  = $status >= 200 && $status < 300 ? '' : 'HTTP ' . (int) $status;
			}
		}

		self::log_attempt( $event, $post_id, $error );
	}

	private static function log_attempt( $event, $post_id, $error ) {
		$entry = array(
			'time'    => gmdate( 'Y-m-d H:i:s' ) . ' UTC',
			'event'   => $event,
			'post_id' => $post_id,
			'status'  => '' === $error ? 'success' : 'failed',
			'error'   => $error,
		);

		$log = get_option( self::LOG_OPTION, array() );
		if ( ! is_array( $log ) ) {
			$log = array();
		}
		array_unshift( $log, $entry );
		update_option( self::LOG_OPTION, array_slice( $log, 0, self::MAX_LOG_ENTRIES ), false );
	}

	public static function register_admin_page() {
		add_options_page(
			'Cloudflare Pages Deploy Hook',
			'Cloudflare Pages Deploy Hook',
			'manage_options',
			'cloudflare-pages-deploy-hook',
			array( __CLASS__, 'render_admin_page' )
		);
	}

	public static function render_admin_page() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}

		$log = get_option( self::LOG_OPTION, array() );
		if ( ! is_array( $log ) ) {
			$log = array();
		}
		$enabled_events = self::enabled_events();
		$event_labels   = array(
			'create'    => 'Create: publish or republish a post',
			'update'    => 'Update: save a published post',
			'delete'    => 'Delete: permanently delete a published post or one trashed from published',
			'trash'     => 'Trash: move a published post to Trash',
			'unpublish' => 'Unpublish: change a published post to another status',
		);
		$queued    = get_option( self::PENDING_OPTION, array() );
		$has_queue = is_array( $queued ) && isset( $queued['due'], $queued['event'], $queued['post_id'] );
		$scheduled = $has_queue ? wp_next_scheduled( self::CRON_HOOK ) : false;
		?>
		<div class="wrap">
			<h1>Cloudflare Pages Deploy Hook</h1>
			<?php if ( isset( $_GET['settings-result'] ) && 'saved' === $_GET['settings-result'] ) : ?>
				<div class="notice notice-success is-dismissible"><p>Settings saved.</p></div>
			<?php elseif ( isset( $_GET['settings-result'] ) && 'invalid' === $_GET['settings-result'] ) : ?>
				<div class="notice notice-error"><p>Enter a valid HTTPS Cloudflare Deploy Hook URL.</p></div>
			<?php endif; ?>
			<?php if ( ! get_option( self::URL_OPTION, '' ) ) : ?>
				<div class="notice notice-warning"><p>Save a Deploy Hook URL to enable deployments.</p></div>
			<?php endif; ?>
			<?php if ( $has_queue ) : ?>
				<div class="notice <?php echo $scheduled && $scheduled > time() ? 'notice-info' : 'notice-warning'; ?>" style="padding: 12px 16px; border-left-width: 5px;">
					<h2 style="margin-top: 0;">Deployment queued</h2>
					<p><strong>Event:</strong> <?php echo esc_html( isset( $event_labels[ $queued['event'] ] ) ? $event_labels[ $queued['event'] ] : $queued['event'] ); ?> &middot; <strong>Post ID:</strong> <?php echo esc_html( $queued['post_id'] ); ?></p>
					<p><strong>Ready after:</strong> <?php echo esc_html( wp_date( 'Y-m-d H:i:s T', (int) $queued['due'] ) ); ?></p>
					<?php if ( ! $scheduled ) : ?>
						<p><strong>No WP-Cron event is scheduled.</strong> Use Retry deployment now below.</p>
					<?php elseif ( $scheduled <= time() ) : ?>
						<p><strong>WP-Cron event is overdue.</strong> Check WP-Cron if it remains here.</p>
					<?php else : ?>
						<p>WP-Cron event: <?php echo esc_html( wp_date( 'Y-m-d H:i:s T', $scheduled ) ); ?></p>
					<?php endif; ?>
				</div>
			<?php endif; ?>
			<h2>Settings</h2>
			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
				<input type="hidden" name="action" value="cloudflare_pages_save_settings">
				<?php wp_nonce_field( 'cloudflare_pages_save_settings' ); ?>
				<table class="form-table" role="presentation">
					<tr>
						<th scope="row"><label for="cloudflare-pages-hook-url">Deploy Hook URL</label></th>
						<td>
							<input type="password" id="cloudflare-pages-hook-url" name="deploy_hook_url" class="regular-text" autocomplete="new-password" value="" placeholder="<?php echo get_option( self::URL_OPTION, '' ) ? 'Configured; leave blank to keep it' : 'Paste the Cloudflare Pages Deploy Hook URL'; ?>">
							<p class="description">The saved URL is never shown here. Enter a new URL to replace it.</p>
							<label><input type="checkbox" name="clear_hook_url" value="1"> Remove the saved URL</label>
						</td>
					</tr>
					<tr>
						<th scope="row">Post events</th>
						<td>
							<fieldset>
								<legend class="screen-reader-text">Post events that trigger a build</legend>
								<?php foreach ( $event_labels as $event => $label ) : ?>
									<label><input type="checkbox" name="deploy_events[]" value="<?php echo esc_attr( $event ); ?>" <?php checked( in_array( $event, $enabled_events, true ) ); ?>> <?php echo esc_html( $label ); ?></label><br>
								<?php endforeach; ?>
								<p class="description">Only selected events queue a build. Drafts, autosaves, and revisions are excluded.</p>
							</fieldset>
						</td>
					</tr>
				</table>
				<?php submit_button( 'Save settings' ); ?>
			</form>
			<h2>When a webhook is sent</h2>
			<table class="widefat striped">
				<thead><tr><th>Event</th><th>Post change that queues a deployment</th></tr></thead>
				<tbody>
					<tr><td>Create</td><td>A post becomes published, including republishing and scheduled publication.</td></tr>
					<tr><td>Update</td><td>An already published post is saved.</td></tr>
					<tr><td>Delete</td><td>A published post is permanently deleted, or a post previously trashed from published status is permanently deleted.</td></tr>
					<tr><td>Trash</td><td>A published post is moved to Trash.</td></tr>
					<tr><td>Unpublish</td><td>A published post changes to a non-trash status such as draft or private.</td></tr>
				</tbody>
			</table>
			<p>Selected changes queue a deployment after the WordPress request finishes. Changes in the next <?php echo esc_html( self::COALESCE_SECONDS ); ?> seconds are combined. WP-Cron sends one HTTP POST after that window, when it next runs. Manual retry sends immediately.</p>
			<h2>Deployments</h2>
			<p>Published post changes within <?php echo esc_html( self::COALESCE_SECONDS ); ?> seconds are combined into one scheduled build. The log keeps the latest <?php echo esc_html( self::MAX_LOG_ENTRIES ); ?> attempts.</p>
			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
				<input type="hidden" name="action" value="cloudflare_pages_retry_deploy">
				<?php wp_nonce_field( 'cloudflare_pages_retry_deploy' ); ?>
				<?php submit_button( 'Retry deployment now' ); ?>
			</form>
			<table class="widefat striped">
				<thead><tr><th>Time</th><th>Event</th><th>Post ID</th><th>Status</th><th>Error</th></tr></thead>
				<tbody>
				<?php if ( empty( $log ) ) : ?>
					<tr><td colspan="5">No deployment attempts yet.</td></tr>
				<?php else : ?>
					<?php foreach ( $log as $entry ) : ?>
						<tr>
							<td><?php echo esc_html( $entry['time'] ); ?></td>
							<td><?php echo esc_html( $entry['event'] ); ?></td>
							<td><?php echo esc_html( $entry['post_id'] ? $entry['post_id'] : '—' ); ?></td>
							<td><?php echo esc_html( $entry['status'] ); ?></td>
							<td><?php echo esc_html( $entry['error'] ); ?></td>
						</tr>
					<?php endforeach; ?>
				<?php endif; ?>
				</tbody>
			</table>
		</div>
		<?php
	}

	public static function save_settings() {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( 'You are not allowed to change deployment settings.' );
		}

		check_admin_referer( 'cloudflare_pages_save_settings' );
		$result = 'saved';
		$submitted_events = isset( $_POST['deploy_events'] ) && is_array( $_POST['deploy_events'] ) ? wp_unslash( $_POST['deploy_events'] ) : array();
		$submitted_events = array_filter( $submitted_events, 'is_string' );
		$enabled_events   = array_values( array_intersect( self::EVENTS, $submitted_events ) );
		update_option( self::EVENTS_OPTION, $enabled_events, false );

		$queued = get_option( self::PENDING_OPTION, array() );
		$queued_event = is_array( $queued ) && isset( $queued['event'] ) ? $queued['event'] : '';
		$queued_event = 'publish' === $queued_event ? 'create' : $queued_event;
		if ( $queued_event && ! in_array( $queued_event, $enabled_events, true ) ) {
			wp_clear_scheduled_hook( self::CRON_HOOK );
			delete_option( self::PENDING_OPTION );
		}

		if ( isset( $_POST['clear_hook_url'] ) && '1' === $_POST['clear_hook_url'] ) {
			delete_option( self::URL_OPTION );
		} elseif ( isset( $_POST['deploy_hook_url'] ) && is_string( $_POST['deploy_hook_url'] ) ) {
			$url = trim( wp_unslash( $_POST['deploy_hook_url'] ) );
			if ( '' !== $url ) {
				$parts = wp_parse_url( $url );
				if ( ! is_array( $parts ) || ! isset( $parts['scheme'], $parts['host'], $parts['path'] ) ||
					'https' !== strtolower( $parts['scheme'] ) || 'api.cloudflare.com' !== strtolower( $parts['host'] ) ||
					! preg_match( '#^/client/v4/pages/webhooks/deploy_hooks/[a-zA-Z0-9_-]+/?$#', $parts['path'] ) ||
					isset( $parts['user'] ) || isset( $parts['pass'] ) ) {
					$result = 'invalid';
				} else {
					update_option( self::URL_OPTION, esc_url_raw( $url ), false );
				}
			}
		}

		wp_safe_redirect( add_query_arg( 'settings-result', $result, admin_url( 'options-general.php?page=cloudflare-pages-deploy-hook' ) ) );
		exit;
	}

	public static function retry_deploy() {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( 'You are not allowed to trigger deployments.' );
		}

		check_admin_referer( 'cloudflare_pages_retry_deploy' );
		wp_clear_scheduled_hook( self::CRON_HOOK );
		delete_option( self::PENDING_OPTION );
		self::send_deploy_hook( 'manual retry', 0 );
		wp_safe_redirect( admin_url( 'options-general.php?page=cloudflare-pages-deploy-hook' ) );
		exit;
	}
}

Cloudflare_Pages_Deploy_Hook::init();
