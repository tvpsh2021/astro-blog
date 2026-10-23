# 淺草先生

An Astro blog built from published posts on a WordPress REST API. Posts are fetched at build time and served as static pages.

The visual system and page behavior are documented in the [visual design guide](design/blog-design.html).

## Local development

Requires Node.js 22.23.4 or later. `.node-version` pins the version used for deployment.

```sh
npm install
cp .env.example .env
npm run dev
```

`WP_API_BASE_URL` is required. Set it in `.env` or the build environment to the WordPress origin without a path, for example `https://wp-blog.jimmmmy.com`. Update it when WordPress moves to a new origin.

The `site` setting in `astro.config.mjs` is the public blog origin, `https://blog.jimmmmy.com`. It is used for canonical URLs, the RSS feed, and the sitemap, and is independent of `WP_API_BASE_URL`.

## Build

```sh
npm run build
npm run preview
```

The build fetches all published posts and all categories with WordPress REST API pagination. It fails if `WP_API_BASE_URL` is not set, the API is unavailable, a fetched item count does not match `X-WP-Total`, a permalink cannot be mapped to the existing `/YYYY/MM/DD/slug/` format, or two posts share a path.

Besides the post pages, the build creates category and tag pages at their WordPress paths (`/category/.../`, `/tag/.../`), `/sitemap.xml`, `/rss.xml`, and `/404.html`.

## Deployment

The site is deployed on Cloudflare Pages. A deployment runs when:

- a commit is pushed to this repository, or
- a post is created, updated, or deleted in WordPress, which calls a Cloudflare Pages deploy hook.

Changes that do not touch a post, such as renaming a category or tag, do not trigger the hook. Redeploy manually from the Pages dashboard to publish them.

Set `WP_API_BASE_URL` in the Pages build environment. Pages uses the Node.js version in `.node-version`; a `NODE_VERSION` variable in the Pages settings would override it.

Cloudflare Pages reads `public/_headers` to set `X-Robots-Tag: noindex` on `pages.dev` hosts only, so preview and staging URLs stay out of search results.
