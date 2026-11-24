# Changelog

All notable changes to WAVEN are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-11-23

First packaged desktop release.

### Added

- Local library with folder scanning, incremental rescans, tag and embedded-artwork
  extraction, search, filters, likes, playlists, and a resumable queue.
- Playback over a loopback HTTP server with Range support, shuffle, repeat, volume,
  seek, and session restore.
- Frameless transparent shell with Glass, Pure, and Solid appearance modes.
- Native mini player (~380x128) in its own window with shared playback state.
- System tray controls, close-to-tray, optional start-hidden and launch-at-login.
- Drag-and-drop layout customizer for the dock, category tabs, and now-playing card.
- Native folder drops, keyboard shortcuts, and Windows/macOS/Linux packaging tasks.

### Known limitations

- No ALAC, DSD, gapless playback, crossfade, EQ, or ReplayGain.
- Linux transparency and tray support depend on the compositor and StatusNotifier host.
- macOS OGG/Opus playback depends on WebKit support.
- Packages are unsigned; signing is left to downstream release owners.

[Unreleased]: https://github.com/12errh/waven/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/12errh/waven/releases/tag/v0.1.0
