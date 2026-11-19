# WAVEN Desktop — Build Plan

**Status:** Phases 0–2 complete; Phase 3 next
**Date:** 2026-11-19
**Target:** Windows, macOS, Linux
**Stack:** Wails v3 + Go + Next.js (static export)

---

## 1. Summary

WAVEN becomes a local-first desktop music player built around the existing UI. The user
selects one or more music folders; the app scans them, reads tags and embedded artwork,
stores the library in SQLite, and plays the files through the desktop webview. The window
is frameless and transparent, the app lives in the system tray, and playback continues
when the window is hidden.

The visual design is preserved. The work is a shell, data layer, and playback rewrite
underneath it — not a redesign.

### Locked-in decisions

| Decision | Choice |
|---|---|
| Desktop shell | Wails v3 (current stable line) |
| Frontend | Existing Next.js app, static export, embedded in the binary |
| Default window look | Glass + ambient cover tint, with Solid fallback |
| Mini player | Included in v1 |
| Home / Discover | Original featured cards and recent-track list; in-library mix queries remain available behind the library API |
| Formats | MP3, AAC/M4A, FLAC, WAV, AIFF, OGG, Opus; audio from MP4/M4V/WebM/MKV containers |
| ALAC | Not in v1 |
| Library scale | Designed for up to ~50k tracks |
| Playback owner | Frontend (`<audio>` + Web Audio); Go owns files, metadata, OS integration |

### Non-goals for v1

- Streaming services, cloud sync, accounts
- Tag editing or library management beyond scanning/removal
- Mobile apps
- DSD or other exotic formats
- Gapless playback, crossfade, EQ, ReplayGain
- File associations as a default handler

---

## 2. Environment and baseline

Verified on the development machine:

- Go 1.27.3
- Node 26.13.1 / npm 12.2.2
- GTK 3.24/4 and WebKitGTK 4.1 present
- `wails3` v3.1.0 installed (`~/go/bin/wails3`)
- Linux (CachyOS, Wayland); Windows and macOS builds require CI or those machines
- Git initialized with the pre-restructure baseline commit `4d00665`

Phase 0 was validated on both a GNOME Wayland session (no StatusNotifier host) and a
Hyprland session with a tray host. Without a host the tray is not created and close quits;
with a host, close hides and a tray click restores the window.

---

## 3. Architecture

```
┌─────────────────────────────────────────────┐
│ Next.js frontend (static export)            │
│ UI · <audio> · Web Audio analyser           │
│ Queue · playback state · shortcuts          │
└──────────────────┬──────────────────────────┘
                   │ Wails bindings + events
┌──────────────────▼──────────────────────────┐
│ Go core                                     │
│ Scanner · tags · artwork · SQLite           │
│ Loopback media server · tray · windows      │
│ Settings · session persistence              │
└─────────────────────────────────────────────┘
```

### Why this split

- **Audio is played by the webview.** WebView2, WKWebView, and WebKitGTK already provide
  hardware-accelerated decoding, buffering, and device handling. Rebuilding that in Go
  would mean owning codecs, seeking, output devices, and platform audio APIs.
- **Go owns the library.** File walking, tag parsing, artwork extraction, duration
  parsing, and SQLite are faster and more reliable in Go than in the renderer.
- **Go serves local files over loopback HTTP.** `http.ServeContent` provides Range
  requests, so seeking in large FLAC/WAV files is immediate and files are never loaded
  into memory. This behaves consistently across all three webviews, unlike custom media
  schemes.
- **Playback state lives in the frontend.** The tray sends commands as events; the
  frontend applies them to the audio element and reports state back to Go for tray labels
  and session persistence.

### Frontend/backend contract

- Wails-generated TypeScript bindings live in `frontend/bindings/`.
- A thin adapter (`frontend/lib/desktop.ts`) wraps them.
- When the adapter detects it is running in a plain browser (no Wails runtime), it serves
  fixture data. This keeps `next dev` usable for UI work without launching the shell.

---

## 4. Repository layout

The Next app moves into `frontend/`. Imports and components do not change.

```
waven/
├─ frontend/                     # existing Next.js app
│  ├─ app/
│  ├─ components/
│  ├─ lib/
│  ├─ public/
│  ├─ next.config.ts             # output: 'export'
│  ├─ package.json
│  └─ out/                       # generated, gitignored, embedded by Go
├─ main.go                       # Wails application, window, tray, embed
├─ go.mod
├─ internal/
│  ├─ library/
│  │  ├─ scanner.go
│  │  ├─ metadata.go
│  │  ├─ duration.go
│  │  ├─ artwork.go
│  │  └─ *_test.go
│  ├─ store/
│  │  ├─ store.go
│  │  ├─ migrations.go
│  │  └─ queries.go
│  ├─ media/
│  │  └─ server.go
│  ├─ desktop/
│  │  ├─ tray.go
│  │  ├─ windows.go
│  │  └─ transparency.go
│  └─ settings/
│     └─ settings.go
├─ build/                        # icons, installer assets, platform manifests
├─ docs/
│  └─ desktop-plan.md
├─ Taskfile.yml                  # Wails v3 build/dev tasks
└─ README.md
```

Generated/ignored: `frontend/node_modules`, `frontend/.next`, `frontend/out`.

---

## 5. Data model

SQLite with WAL mode and foreign keys enabled. Pure-Go driver (`modernc.org/sqlite`) so the
database layer does not add CGO constraints.

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE folders (
    id            INTEGER PRIMARY KEY,
    path          TEXT NOT NULL UNIQUE,
    created_at    INTEGER NOT NULL,
    last_scan_at  INTEGER
);

CREATE TABLE tracks (
    id             INTEGER PRIMARY KEY,
    folder_id      INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
    path           TEXT NOT NULL UNIQUE,
    title          TEXT NOT NULL,
    artist         TEXT NOT NULL DEFAULT '',
    album          TEXT NOT NULL DEFAULT '',
    album_artist   TEXT NOT NULL DEFAULT '',
    genre          TEXT NOT NULL DEFAULT '',
    year           INTEGER,
    track_no       INTEGER,
    disc_no        INTEGER,
    duration_ms    INTEGER NOT NULL DEFAULT 0,
    bitrate_kbps   INTEGER,
    sample_rate    INTEGER,
    channels       INTEGER,
    format         TEXT NOT NULL,
    size_bytes     INTEGER NOT NULL,
    mtime          INTEGER NOT NULL,
    art_id         TEXT,
    accent         TEXT,
    search_text    TEXT NOT NULL,
    liked          INTEGER NOT NULL DEFAULT 0,
    missing        INTEGER NOT NULL DEFAULT 0,
    added_at       INTEGER NOT NULL,
    last_seen_scan INTEGER NOT NULL
);

CREATE INDEX idx_tracks_album
    ON tracks(album_artist, album, disc_no, track_no);
CREATE INDEX idx_tracks_artist ON tracks(artist);
CREATE INDEX idx_tracks_added ON tracks(added_at DESC);
CREATE INDEX idx_tracks_search ON tracks(search_text);
CREATE INDEX idx_tracks_liked ON tracks(liked) WHERE liked = 1;
CREATE INDEX idx_tracks_missing ON tracks(missing) WHERE missing = 1;

CREATE TABLE plays (
    id         INTEGER PRIMARY KEY,
    track_id   INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    started_at INTEGER NOT NULL,
    ms_played  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_plays_track ON plays(track_id, started_at DESC);

CREATE TABLE playlists (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE playlist_tracks (
    playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    track_id    INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    position    INTEGER NOT NULL,
    PRIMARY KEY (playlist_id, track_id)
);
CREATE INDEX idx_playlist_position ON playlist_tracks(playlist_id, position);

CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
```

### Notes

- `search_text` is lowercase, accent-folded, and combines title, artist, album,
  album artist, and genre.
- `liked` and `missing` are booleans stored as 0/1.
- `art_id` is the SHA-256 of the original embedded artwork. Derivatives live on disk in
  the cache directory, named `<art_id>.jpg`.
- Missing tracks are hidden from normal views but keep their play history and playlist
  positions. They are restored if the file reappears.
- The player session and queue are JSON values in `settings` (`player.session`).
- Timestamps are Unix milliseconds unless noted otherwise.

---

## 6. Backend services

### 6.1 Library scanner

**Folder rules**

- Native folder picker.
- Multiple roots supported.
- Overlapping roots are rejected in v1 (a parent of an existing root, or a child of one).
  The user removes the existing root first. This keeps ownership of a track unambiguous.
- Symlinks are not traversed; this avoids loops and paths outside the selected root.
- Hidden/system directories and known junk (`node_modules`, `#recycle`, `@eaDir`) are
  skipped.
- Extension allowlist: `.mp3 .m4a .aac .flac .wav .aiff .aif .ogg .oga .opus`,
  plus audio-bearing video containers `.mp4 .m4v .webm .mkv` (indexed for their audio
  track, never rendered as video). Partially downloaded files (`.part.`, `.temp.`,
  `.ytdl.`, `.download.`) are skipped.

**Scan pipeline**

1. Record `scanStart`.
2. Walk each root with `filepath.WalkDir`.
3. For each allowed file, stat it. If a row exists with the same size and mtime and is not
   marked missing, update `last_seen_scan` and skip parsing.
4. Otherwise parse tags and duration in a worker pool (`min(NumCPU, 8)`), then upsert.
5. After the walk, mark rows unseen in this scan as `missing = 1`.
6. Emit a summary and keep per-file errors in a capped list.

**Metadata**

- `dhowden/tag` for ID3v1/v2, MP4, FLAC, and Ogg. Matroska/WebM tags are not read; those
  files use the filename fallback.
- Filename fallback: `Artist - Title`, `NN - Title`, or the bare filename.
- Album artist falls back to artist; disc number defaults to 1.

**Duration**

Container-header parsing, no full decode:

- FLAC: STREAMINFO total samples / sample rate.
- WAV: `fmt ` + `data` chunk sizes.
- AIFF: `COMM` chunk.
- MP3: first valid frame header plus Xing/Info frame count; fallback to size/bitrate.
- M4A/MP4/M4V: `mvhd` duration.
- WebM/MKV: Matroska `Info` (`TimecodeScale` + `Duration`), including unknown-sized
  segments written by streaming tools.
- OGG/Opus: last page granule position.

If a parser fails, duration is 0. The frontend reports the real duration from
`loadedmetadata` via `Library.SetDuration`, which is persisted.

**Artwork**

- Extract embedded pictures during the same pass.
- Resize to a maximum of 512px on the long edge (`golang.org/x/image/draw`).
- Encode JPEG at quality 85; content-address by SHA-256.
- Store only the hash in SQLite.
- Derive a dominant accent color from an 8×8 sample for gradient fallbacks.
- If there is no embedded art, `art_id` is null and the UI uses the accent/title fallback.

**Concurrency and persistence**

- Parsing runs concurrently; a single writer batches inserts/updates in transactions of
  ~200 rows.
- Progress events are throttled to about 10 per second.
- Scans are cancellable from settings.
- A failed file never aborts the scan; it is reported at the end.

### 6.2 Media server

- Listens on `127.0.0.1:0` (random port) for the lifetime of the app.
- Per-launch token: 32 random bytes, hex encoded.
- Routes:
  - `GET/HEAD /m/{token}/{trackID}` — audio bytes
  - `GET/HEAD /a/{token}/{artID}` — cached artwork
- Validation:
  - Token compared in constant time.
  - Track must exist and resolve to a path inside a registered root (after symlink
    evaluation).
  - Art ID must be a hex hash and resolve inside the artwork cache.
- Audio served with `http.ServeContent`, giving Range, HEAD, and conditional requests.
- MIME map:
  - `mp3` → `audio/mpeg`
  - `m4a/mp4/m4v` → `audio/mp4`
  - `aac` → `audio/aac`
  - `flac` → `audio/flac`
  - `wav` → `audio/wav`
  - `aiff/aif` → `audio/aiff`
  - `ogg/oga/opus` → `audio/ogg`
  - `webm` → `audio/webm`
  - `mkv` → `audio/x-matroska`
- `Access-Control-Allow-Origin: *` so `MediaElementAudioSourceNode` can analyse the
  stream. The unguessable token is the access control; the server never binds to a public
  interface.
- Artwork responses are immutable and long-cached; audio is `no-store`.
- Server shuts down cleanly on quit.

### 6.3 Bindings and events

| Service | Methods |
|---|---|
| `Library` | `PickFolder`, `AddFolder`, `RemoveFolder`, `Rescan`, `CancelScan`, `GetTracks`, `GetAlbums`, `GetArtists`, `GetGenres`, `GetTrack`, `Search`, `GetStats`, `SetLiked`, `SetDuration` |
| `Playlist` | `List`, `Create`, `Rename`, `Delete`, `AddTrack`, `RemoveTrack`, `Reorder` |
| `Player` | `UpdateState`, `GetSession`, `SaveSession`, `RecordPlay` |
| `Settings` | `Get`, `Update` |
| `Window` | `ShowFull`, `ShowMini`, `SetAlwaysOnTop`, `Quit` |

Go → frontend events:

- `scan:progress` — `{ phase, done, total, currentPath }`
- `scan:done` — `{ added, updated, removed, missing, errors }`
- `tray:playPause`
- `tray:next`
- `tray:prev`
- `tray:showMini`
- `app:restored` — optional session-restored hint

Frontend → Go is done through bindings, not events, except for tray commands.

### 6.4 Settings

Stored in SQLite under `settings`:

| Key | Meaning |
|---|---|
| `window.mode` | `glass`, `pure`, `solid` |
| `window.bounds` | JSON `{x,y,width,height,maximized}` |
| `window.miniBounds` | Bounds to restore when leaving mini mode |
| `app.closeToTray` | Hide instead of quit on close |
| `app.startHidden` | Start in the tray |
| `app.autostart` | Launch at login |
| `app.alwaysOnTopMini` | Keep mini player above other windows |
| `library.lastScanAt` | Timestamp |
| `player.volume` | 0.0–1.0 |
| `player.session` | JSON queue/session |
| `cache.artBytes` | Cached artwork size, for the settings screen |

No secrets are stored.

---

## 7. Frontend changes

### 7.1 Code impact map

| Area | Files | Change |
|---|---|---|
| App shell/state | `components/WavenPlayer.tsx` | Replace mock catalog with bindings; own playback state; save session; add desktop adapter |
| Now playing | `components/NowPlayingCard.tsx` | Wire real engine, progress, seek, analyser; window drag strip |
| Track lists | `components/TrackListPanel.tsx` | Real IDs, virtualization, context actions, missing state |
| Screens | `components/SecondaryViews.tsx` | Add Folder/Rescan, local search, in-library mixes, library stats; remove upload/stream forms |
| Navigation | `components/LeftDock.tsx`, `components/TopPillNav.tsx` | Mini-mode entry, desktop shortcuts hint |
| Artwork | `components/CoverImage.tsx` | Local media-server URLs, accent fallback |
| Audio | `lib/audio-engine.ts` | Replaced by `lib/player-engine.ts` (HTMLAudioElement + Web Audio) |
| Logic | `lib/player-logic.ts` | Reuse; fix `repeat: 'off'` wrapping; add tests |
| Types | `lib/types.ts` | Align with generated binding models |
| Mock data | `lib/catalog-data.ts`, `lib/catalog-images.ts` | Keep small fixtures for browser mode; remove bulk imports |
| API | `app/api/music/search/route.ts` | Delete |
| Styling | `app/globals.css`, `app/layout.tsx` | Transparent root, ambient variables, drag regions, focus states |
| Config | `next.config.ts` | `output: 'export'`, unoptimized images, remove standalone |
| Tests | `lib/player-logic.test.ts` | Fix runner and module resolution |

### 7.2 Next.js static export

- `output: 'export'` replaces `output: 'standalone'`.
- `images.unoptimized: true` (the app does not use `next/image` today).
- No route handlers or server actions remain.
- `next/font/google` self-hosts at build time; vendor the font files so builds work
  offline and are reproducible.
- Production: `next build` writes `frontend/out`, embedded with
  `//go:embed all:frontend/out` and served via
  `application.AssetFileServerFS`.
- Development: `wails3 dev` proxies the Next dev server; the media server allows the dev
  origin.

### 7.3 Playback engine

`lib/player-engine.ts`:

- One `HTMLAudioElement`.
- `AudioContext` → `MediaElementAudioSourceNode` → `GainNode` → `AnalyserNode` →
  destination.
- `AudioContext` resumes on the first user gesture.
- State: `idle`, `loading`, `playing`, `paused`, `error`.
- Track change: set `src` to the media URL, call `load()`, play only if the user intended
  playback.
- Seek: `currentTime = ms / 1000`.
- Volume: gain node with a perceptual curve, persisted.
- Progress UI: `requestAnimationFrame` while playing instead of relying on 4Hz
  `timeupdate`.
- Analyser runs only when a visualizer is visible; it stops when the window is hidden or
  the screen is not visible, to keep idle CPU low.
- Errors: map `MediaError` codes to user-facing messages ("This format is not supported
  on this platform") and skip to the next track on request.
- Record a play after 30 seconds or 50% of the track, whichever comes first.

### 7.4 Sessions and queue

Session JSON:

```json
{
  "trackId": 123,
  "positionMs": 45000,
  "queueIds": [12, 123, 98],
  "queueIndex": 1,
  "shuffle": false,
  "repeat": "off",
  "volume": 0.8
}
```

- Saved every 5 seconds while playing, and on pause, track change, hide, and quit.
- Restored **paused** at the saved position, clamped to `duration - 2s`.
- Missing tracks are dropped from the restored queue; the next available track is
  selected.
- `repeat: 'off'` stops at the end of the queue; `repeat: 'all'` wraps; `repeat: 'one'`
  repeats the current track.
- Shuffle uses a stable shuffled order stored in the session so "next" and "previous"
  behave predictably.

### 7.5 UI adaptations that preserve the design

- **Add Folder / Rescan** replace the upload and stream-URL forms, using the same card
  and button styles.
- **Profile** becomes library stats: track count, albums, hours, folders, cache size.
- **Discover** keeps the original three featured cards and the recent-track list.
  The four in-library mix queries (Recently Added, Recently Played, On Repeat,
  Favorites) stay available through `LibraryService.GetMix` for a future
  dedicated surface.
- **Keyboard:** Space, ←/→ seek 5s, N/P next/prev, L like, Cmd/Ctrl+F search, Esc back.
- **Focus states** and visible keyboard navigation are added to interactive controls.
- **Empty states** for: no folders, scanning, no results, no liked tracks, empty playlist.
- **Toasts** for scan completion, skipped files, unsupported formats, and cache clearing.

### 7.6 Search

- Debounced 120ms.
- Normalized query (lowercase, accent-folded).
- `LIKE '%query%'` over `search_text`, ranked by:
  1. title starts with the query
  2. artist starts with the query
  3. any field contains the query
- Results grouped into Songs, Albums, Artists, Playlists.
- Enter plays the top song result; arrow keys move the selection.
- At 50k tracks this is a few milliseconds; no search server or index service needed.

---

## 8. Desktop behavior

### 8.1 Window

- Frameless.
- Default 1280×820, minimum 960×640.
- Custom drag strip at the top.
- macOS: native traffic lights.
- Windows/Linux: custom minimize, maximize, close controls.
- Close hides to tray by default (`app.closeToTray`). Quit is explicit from the tray or
  settings.
- Window bounds, maximized state, and monitor placement are restored with validation
  against currently connected displays.
- Single instance: a second launch shows and focuses the existing window.
- Autostart is optional and off by default. `--hidden` starts in the tray.

### 8.2 Transparency

| Platform | Window option | Native blur | Fallback |
|---|---|---|---|
| Windows 11 22621+ | `BackgroundTypeTranslucent` | Acrylic / Mica | Solid |
| Windows 10 | `BackgroundTypeTransparent` | None | Solid |
| macOS 12+ | `MacBackdropTranslucent` / `Transparent` | Vibrancy; Liquid Glass on macOS 15+ | Solid |
| Linux | `WindowIsTranslucent` | None (compositor-dependent) | Solid |

Important: CSS `backdrop-filter` blurs web content behind an element, not the desktop
behind the window. Frosted glass over the wallpaper requires the platform backdrop.
Linux has no native blur, so its "glass" is translucent tint only.

Three CSS modes, driven by `data-window-mode` on `<html>`:

- **Glass + ambient (default):** desktop visible; cover-derived 64px blurred layer at
  ~55% opacity; dark gradient scrim for contrast.
- **Pure glass:** desktop mostly visible; ambient layer at ~15%; higher contrast scrim.
- **Solid:** opaque `#07080b`; ambient layer fully opaque; current look preserved.

Panels use translucent fills plus `backdrop-filter` for in-app layering. The root and
body are transparent. A one-time hint explains the Solid fallback if transparency looks
wrong.

Platform startup logic:

- Windows: detect the build; default to Solid below 22621 unless the user chooses
  otherwise.
- macOS: choose translucency based on OS version; Liquid Glass only on 15+.
- Linux: default to Glass as requested, but expose Solid prominently. Linux GPU policy is
  set explicitly (`WebviewGpuPolicyOnDemand` or `Always`); Wails disables GPU by default
  when Linux options are omitted.

If Wails cannot switch backdrop types live, the setting applies on restart and says so.

### 8.3 Tray

Menu:

- WAVEN (disabled header)
- Track — Artist (disabled label)
- Play / Pause
- Previous
- Next
- Show WAVEN
- Mini Player
- Quit

Behavior:

- Left click toggles the window on Windows/Linux.
- macOS opens the menu; "Show WAVEN" is first.
- Tray labels update from `Player.UpdateState`.
- Quit sets a real-quit flag before closing, so close-to-tray does not block it.
- Linux uses StatusNotifierItem over D-Bus. GNOME requires the AppIndicator extension;
  otherwise there is no tray icon. The app documents this and offers quit-on-close.

### 8.4 Mini player

- Window resizes to ~380×128.
- Always on top by default.
- Cover, title, artist, transport, and a thin progress bar.
- Drag strip on the strip itself.
- Double-click or Esc expands to the full window; the previous full-window bounds are
  restored.
- Same React state and audio engine; only the layout changes.
- A tray item and a keyboard shortcut can toggle it.

---

## 9. Performance and footprint

Planned changes:

- Move bulk cover JPEGs out of JS imports; keep only a few fixtures for browser mode and
  empty states. This removes several MB from the initial bundle.
- Replace the full-resolution `blur(110px)` layer with a 64px pre-blurred thumbnail
  scaled up with CSS. Visually equivalent, much cheaper on the GPU.
- Virtualize long track and album lists.
- Lazy-load artwork; decode asynchronously; never request full-size originals for list
  rows.
- Stop the analyser when not visible.
- Batch database writes; avoid per-file transactions.
- Remove unused dependencies (`@google/genai`, `firebase-tools`) and audit the rest.

Expected footprint:

- ~20–30MB install size (excluding platform webview runtime)
- ~150–250MB RAM, dominated by the webview
- Low idle CPU when the window is hidden and playback is paused

This is lighter than Electron on disk and idle CPU, but it is not a 30MB-RAM native
player. That trade is intentional: the UI is preserved as-is.

---

## 10. Testing

### Go

- Filename parser and tag fallback.
- Duration parsers for MP3, FLAC, WAV, AIFF, M4A, and OGG fixtures.
- Incremental scan: unchanged files skipped, missing files flagged, reappearing files
  restored.
- Overlapping-root rejection and path validation.
- Media server via `httptest`:
  - 200 full response
  - 206 Range response
  - 403 invalid token
  - 403 path traversal
  - 404 missing track/art
  - correct MIME types
- Search normalization and ranking.
- Playlist reorder and cascade behavior.

### Frontend

- Fix the test runner (`tsx --test` or Vitest) and the extensionless import in
  `lib/player-logic.test.ts`.
- Queue logic: next/prev, shuffle stability, all repeat modes, end-of-queue behavior.
- Search filtering and grouping.
- Playlist position updates.
- Playwright against `next dev` with the browser mock adapter for UI flows. Native Wails
  behavior remains a manual smoke test.

### Manual platform smoke test

Linux (can be done here):

1. Launch with a transparent window.
2. Add a folder with mixed formats.
3. Play, seek, change volume, next/prev.
4. Hide to tray; confirm audio continues; use tray controls.
5. Quit and relaunch; confirm session and window bounds restore.
6. Switch all three window modes.

Windows and macOS: the same checklist on CI-built artifacts, with a human or VM to
interact with the webview. CI cannot validate visual transparency or tray menus by
itself.

---

## 11. Packaging and distribution

| Platform | Artifact | Notes |
|---|---|---|
| Windows | NSIS per-user installer | WebView2 Evergreen runtime required; installer can bootstrap it |
| macOS | `.app` + `.dmg`, arm64 + x64 | Hardened runtime; notarization needs an Apple Developer account |
| Linux | `.deb` + AppImage (best effort) | WebKitGTK and GStreamer runtime dependencies declared |

Linux runtime dependencies include WebKitGTK 4.1, GTK 3, and GStreamer base/good/bad/ugly
plugins. AppImage is best-effort because bundling WebKitGTK is large; `.deb` is the primary
Linux artifact.

CI:

- GitHub Actions matrix: `ubuntu-22.04`, `windows-latest`, `macos-14`.
- Install Go, Node, and `wails3`.
- Build the frontend, then the app.
- Upload artifacts per platform.
- Version injected with `-ldflags "-X main.version=..."`.
- Code signing secrets are optional; unsigned builds are documented as such.

Minimum targets (defaults, adjustable):

- Windows 10 1809+
- macOS 12+
- Ubuntu 22.04+ / WebKitGTK 4.1

---

## 12. Phases

### Phase 0 — Shell and build loop (0.5–1 day)

- [x] `git init`, baseline commit, update `.gitignore`.
- [x] Move the Next app into `frontend/`; reinstall dependencies.
- [x] Install `wails3` (`go install github.com/wailsapp/wails/v3/cmd/wails3@latest`).
- [x] Scaffold `main.go`, `go.mod`, `Taskfile.yml`.
- [x] Configure Next static export and embed `frontend/out`.
- [x] Frameless window with Glass/Solid modes and a drag strip.
- [x] Tray skeleton and close-to-hide behavior.
- [x] Dev loop: Wails + Next HMR; production build; Linux launch.

Implementation notes:

- The dev port is literal (`9245`) in `build/config.yml` because `wails3 dev` does not expand
  environment variables in its readiness check; `Taskfile.yml` must stay in sync.
- The tray is created lazily when a StatusNotifier host is present. Wails already watches for
  host appearance, so a tray created after launch registers without a restart.
- Verified with `WAVEN_SMOKE=1`: the page hydrates, `wails:drag` reaches Go, minimize loses
  focus, close-to-tray hides, and a D-Bus tray activation restores the window.

**Done when:** the existing UI opens in a real Wails window, both dev and production builds
work, and the window can be dragged, hidden, and restored from the tray. ✅

### Phase 1 — Library core (2–4 days)

- [x] SQLite store and migrations.
- [x] Folder picker and root management.
- [x] Scanner with incremental logic, worker pool, progress events.
- [x] Tag parsing and filename fallback.
- [x] Duration parsers.
- [x] Artwork extraction, resize, cache, accent color.
- [x] Bindings for library queries and search.
- [x] Wire Songs, Albums, Artists, Genres to real data.
- [x] Scanning and empty states.

**Done when:** a real music folder scans, the library renders correctly, artwork appears,
and a second scan skips unchanged files.

### Phase 2 — Playback (2–3 days) ✅

- [x] Loopback media server with token, Range, and MIME handling.
- [x] Replace the synth engine with the HTMLAudioElement/Web Audio engine.
- [x] Play, pause, seek, volume, next, previous, shuffle, repeat.
- [x] Queue management and end-of-queue behavior.
- [x] Session save/restore (paused on launch).
- [x] Keyboard shortcuts, including ←/→ seek.
- [x] Real progress and analyser-driven visualizer.
- [x] Unsupported-format handling.
- [x] Play recording for mixes.

**Done when:** a 50MB FLAC seeks instantly, all repeat modes behave, and relaunching
restores the queue and position.

Verified by `internal/media/server_test.go` (mid-file Range on a 50 MB FLAC),
`internal/desktop/player_test.go` (session round-trip, pruning, corrupt JSON,
shutdown flush), and `frontend/lib/player-logic.test.ts` (stable shuffle, all
repeat modes, end-of-queue, resume clamping, play thresholds).

### Phase 3 — Desktop behavior (1–2 days)

- [ ] Tray menu with live now-playing state and controls.
- [ ] Close-to-tray, quit flag, single instance.
- [ ] Window bounds and monitor validation.
- [ ] Settings screen: library folders, appearance, playback, about.
- [ ] Autostart toggle and `--hidden`.
- [ ] Transparency detection/fallbacks per platform.

**Done when:** closing hides the app, audio keeps playing, tray controls work, a second
launch focuses the first, and settings survive restart.

### Phase 4 — Library UX (1–2 days)

- [ ] Local search with grouped results and keyboard navigation.
- [ ] Likes persisted in SQLite.
- [ ] Playlist create/rename/delete/add/remove/reorder.
- [ ] Drag-and-drop files/folders.
- [ ] In-library mixes.
- [ ] Library stats screen and cache size.
- [ ] Toast/error polish.

**Done when:** all screens use real data, playlists and likes survive restart, and dropping
a folder starts a scan.

### Phase 5 — Mini player and polish (1–2 days)

- [ ] Mini window resize, bounds restore, always-on-top.
- [ ] Compact layout with cover, title, transport, progress.
- [ ] Expand/collapse via double-click, Esc, tray.
- [ ] Focus states, reduced-motion support, contrast pass on all three modes.
- [ ] Final empty/loading/error states.

**Done when:** mini mode works from the tray and keyboard, expands cleanly, and the Glass,
Pure, and Solid modes are all legible over bright and dark wallpapers.

### Phase 6 — Packaging and CI (2–3 days)

- [ ] App icons and platform metadata.
- [ ] Windows NSIS installer.
- [ ] macOS `.app`/`.dmg` for arm64 and x64.
- [ ] Linux `.deb` and AppImage.
- [ ] GitHub Actions matrix and artifact upload.
- [ ] Version injection.
- [ ] Smoke-test checklist and release notes.

**Done when:** CI produces installable artifacts for all three platforms and the checklist
passes on Linux plus at least one Windows and one macOS run.

### Later (not v1)

- OS media controls (MPRIS, SMTC, Now Playing) and hardware media keys
- Folder watching with `fsnotify`
- Gapless playback, crossfade, EQ, ReplayGain
- M3U import/export and smart playlists
- Lyrics, scrobbling, Discord presence
- Internet radio, Subsonic/Jellyfin
- Tag editing and duplicate detection

---

## 13. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Linux tray missing on GNOME without AppIndicator | No tray icon, hidden app is hard to recover | Quit-on-close fallback, documentation, settings hint |
| Linux transparency/compositor differences | Window may look black or unblended | Solid mode, per-platform defaults, test GNOME/KDE/X11/Wayland |
| OGG/Opus on macOS WKWebView | Tracks may not play | Test early; add a contained Go decode-to-WAV cache for unsupported tracks if needed |
| Missing GStreamer plugins on Linux | AAC/MP3/AIFF may fail | Declare dependencies in the package; clear error messages |
| Hidden webview throttling | Playback could pause when hidden | Test on all three OSes before packaging; keep the window hidden, not destroyed |
| Wails v3 API churn | Rework during implementation | Pin the Wails version in `go.mod`; isolate platform code in `internal/desktop` |
| Code signing costs | Gatekeeper/SmartScreen warnings | Unsigned dev builds documented; signing as a release task |
| Large library performance | Slow scan or UI | Incremental scan, worker pool, batched writes, virtualized lists |
| No git history before the move | Accidental loss during restructure | `git init` + baseline commit first |

---

## 14. Defaults and assumptions

- Bundle ID `com.waven.player`; display name `WAVEN`; version `0.1.0`.
- Library size up to ~50k tracks, local disk.
- Single user, no sync, no accounts, no network required.
- English UI in v1; strings kept in one place for future localization.
- Close-to-tray on, autostart off, start visible, no file associations.
- App icon uses a typographic W mark unless a logo is supplied.
- Windows 10 1809+, macOS 12+, Ubuntu 22.04+.

---

## 15. Immediate next step

1. Approve this document.
2. Initialize git and commit the current app as the baseline.
3. Execute Phase 0 and show the existing UI running in a transparent, frameless Wails
   window.
4. Continue with the library core only after the shell is verified.

This document is the source of truth for scope and sequencing. It should be updated when a
platform constraint or a product decision changes.
