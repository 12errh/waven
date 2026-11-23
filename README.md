# WAVEN

A local-first desktop music player. The interface is a Next.js app embedded in a Go/Wails
shell, so the app ships as a single native binary with full filesystem access.

> Phases 0–6 are complete: desktop shell, library core, playback, customization, mini player,
> and packaging/CI. See [`docs/desktop-plan.md`](docs/desktop-plan.md) and
> [`RELEASE_NOTES.md`](RELEASE_NOTES.md).

## Requirements

- Go 1.26+
- Node.js 20+ and npm
- `wails3` v3.1.0 on `PATH` (`go install github.com/wailsapp/wails/v3/cmd/wails3@v3.1.0`)
- Linux: GTK 3/4 and WebKitGTK 4.1 development packages

## Development

The dev loop runs the Next.js dev server and rebuilds/relaunches the Go app on changes:

```sh
wails3 task dev        # or: wails3 dev -config ./build/config.yml -port 9245
```

`wails3 dev` proxies `http://localhost:9245` into the native window, so edits in `frontend/`
hot-reload. Go edits rebuild and relaunch `bin/waven-dev`.

Notes:

- The dev port is fixed at `9245` in `build/config.yml`. The readiness check does not expand
  environment variables, so keep `DEV_PORT` in `Taskfile.yml` in sync if you change it.
- `WAVEN_DEBUG=1` enables window lifecycle logging.
- `WAVEN_SMOKE=1` runs an automated check of drag, window controls, appearance, settings,
  mini/full switching, close-to-tray, and tray restore. Add `WAVEN_SMOKE_LIBRARY=1` to also
  verify transport commands from the compact window against a seeded library. Use these when
  touching window, tray, or mini-player code. See [`docs/smoke-checklist.md`](docs/smoke-checklist.md).

## Production build

```sh
wails3 task build      # builds frontend/out, then embeds it into bin/waven
./bin/waven
```

The production binary uses the `production` build tag, which embeds `frontend/out` and
disables Wails' debug logging. It does not need the source tree at runtime. The build also
regenerates `frontend/bindings/` from the Go services, so a changed service signature cannot
silently drift from the TypeScript bridge.

`VERSION` injects the user-facing version shown in Settings → About:

```sh
wails3 task build VERSION=1.2.3
```

## Packaging

Package tasks build on top of the production build and run on native CI runners:

```sh
wails3 task package:linux:deb VERSION=0.1.0 ARCH=amd64
wails3 task package:linux:appimage VERSION=0.1.0
wails3 task package:windows VERSION=0.1.0 ARCH=amd64   # needs makensis + WebView2 bootstrapper
wails3 task package:darwin VERSION=0.1.0 ARCH=arm64   # macOS only; .app + .dmg
```

Artifacts land in `bin/`. Linux dependencies are declared in `build/linux/nfpm/nfpm.yaml`;
Windows installer metadata lives in `build/windows/`; the macOS bundle metadata is in
`build/darwin/Info.plist`. The `.github/workflows/release.yml` matrix builds and uploads all
artifacts on `v*` tags. Installers are unsigned unless signing is added to the release flow.

Before publishing, run the manual pass in [`docs/smoke-checklist.md`](docs/smoke-checklist.md).

## Library

Add a music folder from **Library → Add folder**. The native picker registers the root,
starts a scan, and the home screen switches from fixtures to real data once the first scan
finishes.

- Supported formats: MP3, AAC/M4A, FLAC, WAV, AIFF, OGG, and Opus. MP4, M4V, WebM, and
  MKV files are indexed for their audio track (music videos play as audio). ALAC is not
  supported.
- Tags are read with `dhowden/tag`; missing title/artist fall back to the filename. Durations
  are parsed from container headers, and the webview's reported duration fills any gap.
- Embedded artwork is resized to 512 px on its long edge, stored as a content-addressed JPEG,
  and sampled for the accent color used by the UI.
- Scans are incremental: unchanged files are skipped by size and mtime, missing files are
  hidden only after a scan completes, and cancelling leaves the previous scan's state intact.
- Search, filters, albums, artists, genres, likes, and stats all run against SQLite. Playback
  streams through a per-launch token on `127.0.0.1` so `<audio>` can seek with Range requests.

Data lives in the platform config and cache directories by default:

- Database: `<config>/waven/waven.db`
- Artwork cache: `<cache>/waven/artwork`
- Overrides: `WAVEN_DATA_DIR` and `WAVEN_CACHE_DIR` (both are useful for a throwaway library).

## Layout

```
frontend/          Next.js app (static export to frontend/out)
main.go            Wails application entry point
internal/desktop/  Window, tray, and smoke-test behavior
assets_prod.go     Embedded frontend for production builds
assets_dev.go      Disk-served frontend for development builds
build/             Wails dev config and app/tray icons
docs/              Desktop plan and architecture notes
```

## Platform behavior

- Frameless, transparent window. Glass, Pure, and Solid appearance modes are CSS-driven.
- The window header is a drag strip; interactive controls opt out with `.wails-no-drag`.
- The mini player is a dedicated ~380×128 native window. Playback stays in the hidden full
  window, so expanding restores the exact queue and position and the full window remains
  resizable. `M` toggles it; `Esc` or the expand button returns to the full window.
- Close hides to the system tray when a StatusNotifier host is present (KDE, XFCE, most
  tiling-WM panels, GNOME with AppIndicator support). Without a host, close quits, matching
  the fallback in `docs/desktop-plan.md` §8.3.
