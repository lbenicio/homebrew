# Homebrew Casks

Add one Cask per application here after its installer is available in R2 and its SHA-256 has been verified. Homebrew Casks require a version, download URL, checksum, and install artifact; do not use placeholder checksums or `:no_check` for these releases.

Publish installers to the `cdn` R2 bucket under this key layout:

```text
homebrew/applications/<app>/<version>/<filename>
```

The Worker serves those objects at:

```text
https://<worker-host>/v1/downloads/<app>/<version>/<filename>
```

Use the deployed Worker hostname in each Cask URL. Keep app slugs, version path segments, and filenames URL-safe. See the [Homebrew Cask Cookbook](https://docs.brew.sh/Cask-Cookbook) for Cask stanzas and artifact syntax.
