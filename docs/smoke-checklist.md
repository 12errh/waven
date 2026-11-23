# Release smoke checklist

Run this against a **production build** (`wails3 task build`) on each platform before
publishing an artifact. Automated smoke hooks (`WAVEN_SMOKE=1`, optionally
`WAVEN_SMOKE_LIBRARY=1` with a seeded library) cover the window lifecycle; the checks
below are the human pass.

## All platforms

- [ ] First launch with an empty library shows the fixture UI; adding a folder starts a scan.
- [ ] Scanning a folder with nested albums populates tracks, albums, artists, genres, and artwork.
- [ ] Play, pause, next, previous, seek, volume, mute, shuffle, and repeat all work.
- [ ] Likes and playlists survive a full quit and relaunch.
- [ ] The player queue and position resume after relaunch (paused).
- [ ] Search, filters, and library navigation respond with real data.
- [ ] Drag/drop customizer: dock, nav, and hero positions move; split resizes; reset restores defaults.
- [ ] Appearance modes (Glass / Pure / Solid) change immediately and persist.
- [ ] The window header drags; controls do not drag the window.
- [ ] Close hides to tray when a tray host is available; tray click restores.
- [ ] Without a tray host, close quits instead of stranding the app.
- [ ] "Launch at login" writes and removes the platform login entry.

## Mini player

- [ ] The mini button (or `M`) opens a genuinely compact ~380x128 window, not a small layout in a full frame.
- [ ] The mini window keeps the cover, track, transport, and seek strip visible.
- [ ] Play/pause, next/previous, seek, and like from the mini window act on the same playback session.
- [ ] The hidden full window continues playing audio while the mini window is open.
- [ ] `Esc`, the expand button, or the tray's **Full Player** action restores the full window at its saved size.
- [ ] The full window remains resizable after expanding.
- [ ] Mini bounds and full bounds survive a relaunch.
- [ ] The compact window's close button hides it to tray; the tray restores it.
- [ ] Always-on-top preference applies to the live mini window.

## Linux

- [ ] Test on GNOME/Wayland (with and without AppIndicator), KDE, and an X11 session.
- [ ] `.deb` installs with `sudo apt install ./waven-linux-amd64.deb` and launches from the desktop entry.
- [ ] AppImage runs with `--appimage-extract-and-run` if FUSE is unavailable.
- [ ] GStreamer plugins play MP3, AAC/M4A, FLAC, WAV, AIFF, OGG, and Opus.
- [ ] Artwork and accent colors render in cards and the now-playing view.

## Windows

- [ ] NSIS per-user installer runs without an admin prompt and creates Start Menu / Desktop shortcuts.
- [ ] WebView2 bootstrapper installs the runtime when it is missing.
- [ ] Uninstall removes the app, shortcuts, and local WebView2 data.
- [ ] Close hides to tray; the tray icon restores or quits.

## macOS

- [ ] Both arm64 and amd64 `.dmg` files mount and the app launches from Applications.
- [ ] The .app bundle carries the WAVEN icon and `com.waven.player` identifier.
- [ ] Gatekeeper warning on unsigned builds is documented; signed/notarized builds launch cleanly.
- [ ] Close hides to tray; the menu bar / dock restores the app.

## Version check

- [ ] About shows the injected version (`Window.Info().Version`), matching the artifact filename.
