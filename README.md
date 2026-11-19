# WAVEN

A local-first desktop music player. The interface is a Next.js app embedded in a Go/Wails
shell, so the app ships as a single native binary with full filesystem access.

> Phase 0 (desktop shell and build loop) is complete. The library scanner and playback
> engine are the next milestones; see [`docs/desktop-plan.md`](docs/desktop-plan.md).

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
- `WAVEN_SMOKE=1` runs an automated 8-second check of drag, minimize, close-to-tray, and tray
  restore. Use it when touching window or tray code.

## Production build

```sh
wails3 task build      # builds frontend/out, then embeds it into bin/waven
./bin/waven
```

The production binary uses the `production` build tag, which embeds `frontend/out` and
disables Wails' debug logging. It does not need the source tree at runtime.

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
- Close hides to the system tray when a StatusNotifier host is present (KDE, XFCE, most
  tiling-WM panels, GNOME with AppIndicator support). Without a host, close quits, matching
  the fallback in `docs/desktop-plan.md` §8.3.
