# Changelog

All notable changes to this project are documented here.

## [Unreleased]

### Added

- Add the Suohai `0.1.0` Cask with a SHA-256-pinned download from the R2-backed Worker.
- Add the SlowQuitApps `0.8.2` Cask with a SHA-256-pinned download from the R2-backed Worker.
- Add the Quick Look Image Size `3.0` Cask with a SHA-256-pinned download for the unsigned local build.
- Remove the FileZilla mirroring workflow so its archives are not uploaded to the public CDN.

## [0.1.0] - 2026-11-15

### Added

- Set up a Cloudflare Worker that streams versioned application installers from the `cdn` R2 bucket.
- Add a Homebrew Cask directory and document the required artifact and checksum workflow.
- Add GitHub Actions checks and secret-backed Worker deployment.
