# Contributing to WAVEN

WAVEN is a local-first desktop music player. The Go/Wails process owns the window, tray,
SQLite library, and loopback media server; the Next.js frontend is a static export embedded
into the binary. Keep changes inside that split rather than adding a second source of truth.

## Prerequisites

- Go 1.26+
- Node.js 20+ and npm
- `wails3` v3.1.0 (`go install github.com/wailsapp/wails/v3/cmd/wails3@v3.1.0`)
- Linux: GTK 3, WebKitGTK 4.1, and GStreamer development packages

## Development loop

```sh
npm --prefix frontend ci
wails3 task dev    # Next.js on :9245 with HMR, Go hot restart
```

Regenerate and commit `frontend/bindings/` whenever an exported Go service method or
struct changes. A normal `wails3 task build` does this as part of the frontend build.

## Checks before opening a pull request

Run the narrow checks that cover your change, then the full set:

```sh
gofmt -l $(git ls-files '*.go')     # must print nothing
go vet ./internal/... .
go test -tags gtk3 ./internal/... .

cd frontend
npm run lint
npm run typecheck
npm test
npm run build
```

Desktop-shell, window, tray, playback, or packaging changes also need the manual pass in
[`docs/smoke-checklist.md`](docs/smoke-checklist.md) on the platforms you changed. State
which platforms you tested in the pull request; CI only exercises Linux.

## Code expectations

- Frontend state that must survive a relaunch belongs in the Go `settings` table, not in
  `localStorage`. Browser storage is only for the fixture preview.
- Use the existing controllers (`use-library`, `use-settings`) instead of calling bindings
  directly from views. Keep pure queue/layout logic in `lib/` and unit-test it.
- Keep SQLite migrations append-only. Never edit an applied migration.
- Avoid new runtime dependencies unless the existing stack cannot do the job.
- Match the surrounding style; keep commit subjects short and imperative.
