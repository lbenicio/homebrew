# Homebrew Tap and Download Worker

This repository holds the Homebrew Casks and a Cloudflare Worker that streams application installers from the `cdn` R2 bucket. The Worker is read-only: it serves only objects under the `homebrew/applications/` key prefix and does not list, upload, or delete bucket contents.

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

The Suohai 0.1.0 installer is staged in the separate CDN repository at `cdn/src/homebrew/applications/suohai/0.1.0/Suohai.dmg`. Manually upload that file to the identical R2 key before the Cask download will work. The separate `cdn` repository in this workspace still defines AWS S3 and CloudFront infrastructure; this Worker binds to the Cloudflare R2 bucket named `cdn`.

## Local development

```sh
npm ci
npm run dev
```

Wrangler uses a local R2 binding by default. To test against the deployed bucket, configure a remote R2 binding locally after confirming you want local runs to read production objects; keep remote-only settings out of the shared Worker configuration.

## Casks

The `suohai` Cask installs Suohai 0.1.0, and the `slowquitapps` Cask installs SlowQuitApps 0.8.2 from `https://homebrew.lbenicio.dev`. FileZilla's Cask is generated and updated by the weekly workflow after it verifies and mirrors the original vendor archives. See [Casks/README.md](Casks/README.md) for staged files, R2 keys, and required GitHub Secrets. Add future Casks only with real installers and verified SHA-256 checksums.

The Worker is configured for the custom domain `homebrew.lbenicio.dev` and the account's `workers.dev` hostname. Cloudflare will create the custom-domain DNS record when the Worker is deployed. Once this repository exists on GitHub, its deployment workflow uses the `CLOUDFLARE_API_TOKEN` GitHub Secret to deploy `wrangler.jsonc` on pushes to `main`. Pull requests run the TypeScript check without access to deployment secrets.

## Commands

```sh
npm run typecheck
npm run types
npm run deploy
```
