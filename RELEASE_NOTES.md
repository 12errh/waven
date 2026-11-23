# WAVEN 0.1.0

First packaged desktop release. WAVEN is a local-first music player for your own library:
add folders, scan tags and embedded artwork, and play everything from one window while the
library stays in SQLite on your machine.

## Highlights

- Frameless, transparent shell with Glass, Pure, and Solid appearance modes.
- Library scan with incremental updates, artwork caching, search, filters, playlists, likes,
  and a resumable queue.
- Floating top navigation and a drag-and-drop layout customizer for the dock, hero, and tabs.
- Compact mini player in its own native window; playback continues in the hidden full window.
- System tray with transport controls, show/hide, mini/full switch, and optional start hidden.
- Native folder drops, keyboard shortcuts, and per-platform autostart.

## Artifacts

| Platform | Artifact |
|---|---|
| Linux | `waven-linux-amd64.deb`, AppImage (best effort) |
| Windows | per-user NSIS installer (amd64) |
| macOS | `waven-darwin-arm64.dmg`, `waven-darwin-amd64.dmg` |

Packages are unsigned. On macOS, right-click → Open the first time; on Windows, SmartScreen
may warn until the installer is signed.

## Known limitations

- No ALAC, DSD, gapless playback, crossfade, EQ, or ReplayGain in 0.1.0.
- Linux transparency and tray behavior depend on the compositor and StatusNotifier host;
  without a host, closing the window quits.
- macOS OGG/Opus playback depends on WebKit support; other formats are unaffected.
- AppImage is best-effort: WebKitGTK is not bundled, so the host must provide it.

## Verification

See `docs/smoke-checklist.md`. CI builds all artifacts on tagged releases and uploads them as
workflow artifacts; published installers should be attached to the matching GitHub release.
