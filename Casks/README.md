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

## SlowQuitApps

The `slowquitapps` Cask installs version `0.8.2`. Its signed DMG is staged at:

```text
cdn/src/homebrew/applications/slowquitapps/0.8.2/SlowQuitApps-0.8.2.dmg
```

Manually upload it to the matching R2 key before installing the Cask. The release requires macOS 12 or later and Accessibility permission. It is signed with Developer ID but is not notarized; macOS may warn on first launch.

## Quick Look Image Size

The `lbenicio-qlimagesize` Cask installs version `3.0`. Its unsigned local-build DMG is staged at:

```text
cdn/src/homebrew/applications/qlimagesize/3.0/Quick-Look-Image-Size-3.0-UNSIGNED.dmg
```

Manually upload it to `homebrew/applications/qlimagesize/3.0/Quick-Look-Image-Size-3.0-UNSIGNED.dmg` in R2 before installing the Cask. This build is unsigned and not notarized; macOS may warn or prevent it from opening. Open the app once, then enable its extension under System Settings > General > Login Items & Extensions > Quick Look.
