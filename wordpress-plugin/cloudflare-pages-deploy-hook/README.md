# Cloudflare Pages Deploy Hook for WordPress

A small WordPress plugin that calls a Cloudflare Pages Deploy Hook for selected changes to standard posts. Draft saves, autosaves, and revisions do not trigger builds. Relevant changes within 20 seconds are combined into one build.

## Install

1. Create a [Cloudflare Pages Deploy Hook](https://developers.cloudflare.com/pages/configuration/deploy-hooks/) for the branch to build.
2. In WordPress admin, go to **Plugins → Add New → Upload Plugin**, select `cloudflare-pages-deploy-hook.zip`, and install or replace the existing plugin. The plugin requires WordPress 5.6+ and PHP 7.4+.
3. Open **Settings → Cloudflare Pages Deploy Hook**, paste the Deploy Hook URL, choose the post events, and save. The URL is stored in the WordPress options table and is never displayed again in the settings form. Leave the field blank to keep the saved URL, or select **Remove the saved URL** to delete it.

## Post events

- **Create:** a post becomes published or is republished, including a scheduled post reaching its publish time.
- **Update:** an already published post is saved.
- **Delete:** a published post is permanently deleted, or a post previously trashed from published status is permanently removed from Trash.
- **Trash:** a published post is moved to Trash.
- **Unpublish:** a published post changes to another non-trash status, such as draft or private.

On upgrade, Create, Update, Trash, and Unpublish remain enabled by default; Delete starts disabled. All options can be unchecked. A queued deployment is canceled if its event is disabled before it runs.

Selected changes are queued after the WordPress request finishes. Changes in the next 20 seconds are combined into one deployment. WP-Cron sends the HTTP POST after that window when it next runs. Manual retry sends immediately. The settings page includes a table explaining when each event is detected.

## Operations

Open **Settings → Cloudflare Pages Deploy Hook** as an administrator. A queued deployment is shown prominently with its event, post ID, and scheduled time; overdue or missing WP-Cron events are highlighted. The page also shows the latest 20 attempts, including failures, without recording the secret URL or response body. Use **Retry deployment now** after fixing the cause of a failed request. A retry triggers a fresh build of the current site content; it does not replay an old post change. Anyone with access to the WordPress database can read the saved URL, so protect database backups and access accordingly.

Requests use HTTPS, a 10-second timeout, no redirects, and WordPress's safe HTTP API. A 2xx response means Cloudflare accepted the build request; check the Cloudflare Pages deployment dashboard for the eventual build result. This plugin does not automatically retry failed requests. Saves after the waiting period can trigger a separate build.

The 20-second waiting period uses WP-Cron. WP-Cron runs due jobs on a later site request, so a low-traffic site may start the build later than 20 seconds. If WP-Cron is disabled, configure a system scheduler to run `wp-cron.php`; otherwise queued builds will not run. Manual retry sends immediately and cancels any queued build.
