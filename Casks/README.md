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
