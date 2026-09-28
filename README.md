# 淺草先生

An Astro blog built from published posts on a WordPress REST API.

The visual system and page behavior are documented in the [visual design guide](design/blog-design.html).

## Local development

```sh
npm install
cp .env.example .env
# Set WP_API_BASE_URL in .env to the WordPress origin before starting Astro.
npm run dev
```

`WP_API_BASE_URL` is the WordPress origin used to fetch posts at build time. It is required and can be set in `.env` or the build environment. Update it when WordPress moves to a new origin.

The `site` setting in `astro.config.mjs` is the public Astro origin. It is used for canonical URLs and remains `https://blog.jimmmmy.com` after WordPress moves.

## Build

```sh
npm run build
npm run preview
```

The build fetches all published posts with WordPress REST API pagination. It fails if the API is unavailable, the reported post count does not match the fetched count, or a permalink cannot be mapped to the existing `/YYYY/MM/DD/slug/` format.

The build also creates `/sitemap.xml`, `/rss.xml`, and `/404.html`. Cloudflare Pages reads `public/_headers` to set `X-Robots-Tag: noindex` on `pages.dev` hosts only. Set `WP_API_BASE_URL` in the Pages build environment before deploying.
