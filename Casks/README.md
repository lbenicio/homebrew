# Homebrew Casks

The `suohai` Cask installs Suohai `0.1.0`. Its local installer is staged at:

```text
cdn/src/homebrew/applications/suohai/0.1.0/Suohai.dmg
```

Manually upload it to the matching R2 key before installing the Cask. Add future Casks here only with real installers and verified SHA-256 checksums; do not use placeholder checksums or `:no_check`.

Publish installers to the `cdn` R2 bucket under this key layout:

```text
homebrew/applications/<app>/<version>/<filename>
```

The Worker serves those objects at:

```text
https://homebrew.lbenicio.dev/v1/downloads/<app>/<version>/<filename>
```

Use the deployed Worker hostname in each Cask URL. Keep app slugs, version path segments, and filenames URL-safe. See the [Homebrew Cask Cookbook](https://docs.brew.sh/Cask-Cookbook) for Cask stanzas and artifact syntax.

## FileZilla

The `Update FileZilla Cask` workflow runs weekly and can also be started manually. It reads the stable version and download links from FileZilla's official download page, verifies the Intel and Apple Silicon archives against the publisher's SHA-512 manifest, and mirrors the unchanged archives into the `cdn` R2 bucket. It then opens a pull request that adds or updates `Casks/filezilla.rb` with the pinned SHA-256 values and versioned Worker URLs.

Before the workflow can run, configure these repository GitHub Secrets:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_R2_ACCESS_KEY_ID`
- `CLOUDFLARE_R2_SECRET_ACCESS_KEY`

Create the R2 credentials with access limited to the `cdn` bucket. The updater writes only immutable versioned objects below `homebrew/applications/filezilla/`; it refuses to overwrite an existing object if its checksum differs. The `GH_TOKEN` is supplied by GitHub Actions with only the repository contents and pull request permissions needed by the workflow.
