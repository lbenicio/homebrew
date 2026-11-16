# Homebrew Tap and Download Worker

This repository holds the Homebrew Casks and a Cloudflare Worker that streams application installers from the `cdn` R2 bucket. The Worker is read-only: it serves only objects under the `homebrew/` key prefix and does not list, upload, or delete bucket contents.

## Download URL and R2 layout

The Worker accepts `GET` and `HEAD` requests at:

```text
/v1/downloads/<app>/<version>/<filename>
```

It maps the request to this key in the `cdn` bucket:

```text
homebrew/applications/<app>/<version>/<filename>
```

For example, `GET /v1/downloads/example-app/1.2.3/Example-1.2.3.dmg` reads `homebrew/applications/example-app/1.2.3/Example-1.2.3.dmg`. Requests are limited to one filename below this prefix; path traversal, query strings, writes, and bucket listing are not supported. Versioned downloads support byte ranges, conditional requests, and immutable caching.

The Cloudflare R2 bucket `cdn` currently contains website assets and post images, but no Homebrew installers. Upload each installer under the layout above before adding its Cask. The separate `cdn` repository in this workspace still defines AWS S3 and CloudFront infrastructure; this Worker binds to the Cloudflare R2 bucket named `cdn`.

## Local development

```sh
npm ci
npm run dev
```

Wrangler uses a local R2 binding by default. To test against the deployed bucket, configure a remote R2 binding locally after confirming you want local runs to read production objects; keep remote-only settings out of the shared Worker configuration.

## Casks

Add Cask definitions under `Casks/` only when the corresponding installer is present in R2 and its SHA-256 checksum is known. See [Casks/README.md](Casks/README.md) for the object layout and URL pattern. The current app catalog links to App Store pages and does not provide downloadable installers, so this scaffold does not invent Cask versions or checksums.

Once this repository exists on GitHub, its deployment workflow uses the `CLOUDFLARE_API_TOKEN` GitHub Secret to deploy `wrangler.jsonc` on pushes to `main`. Pull requests run the TypeScript check without access to deployment secrets. The Worker is configured for its `workers.dev` hostname; a custom domain can be attached separately.

## Commands

```sh
npm run typecheck
npm run types
npm run deploy
```
