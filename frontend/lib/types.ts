export type TopTab = 'Discover' | 'Playlists' | 'Artists' | 'Albums' | 'Genres';

export type DockSection = 'home' | 'search' | 'library' | 'likes' | 'profile';

export type RepeatMode = 'off' | 'all' | 'one';

/** Kinds exposed by the Go `GetMix` binding and the Discover screen. */
export type MixKind = 'recently_added' | 'recently_played' | 'on_repeat' | 'favorites';

/**
 * Resumable playback state persisted in SQLite under `player.session`. The
 * queue and its stable shuffled order belong to the session so relaunching
 * restores exactly what was playing.
 */
export interface PlayerSession {
  trackId: number;
  positionMs: number;
  queueIds: number[];
  queueIndex: number;
  shuffle: boolean;
  shuffleOrder: number[];
  repeat: RepeatMode;
  volume: number;
  muted: boolean;
  updatedAt: number;
}

/** Live now-playing snapshot mirrored to the Go tray and compact window. */
export interface PlayerState {
  trackId: number;
  title: string;
  artist: string;
  album: string;
  coverSrc: string;
  liked: boolean;
  playing: boolean;
  positionMs: number;
  durationMs: number;
}

/**
 * Track mirrors the Wails `Library.Track` model. It is intentionally a plain
 * interface rather than the generated class so fixtures can build tracks
 * without importing the runtime bindings.
 */
export interface Track {
  id: number;
  title: string;
  artist: string;
  album: string;
  albumArtist: string;
  genre: string;
  year: number;
  trackNo: number;
  discNo: number;
  durationMs: number;
  durationSec: number;
  bitrateKbps: number;
  sampleRate: number;
  channels: number;
  format: string;
  sizeBytes: number;
  artId: string;
  coverSrc: string;
  accentHex: string;
  audioUrl: string;
  liked: boolean;
  missing: boolean;
  addedAt: number;
}

export interface TrackQuery {
  text: string;
  artist: string;
  album: string;
  albumArtist: string;
  genre: string;
  likedOnly: boolean;
  sort: string;
  limit: number;
  offset: number;
}

export interface TrackPage {
  tracks: Track[];
  total: number;
}

export interface Folder {
  id: number;
  path: string;
  createdAt: number;
  lastScanAt: number | null;
}

export interface Album {
  id: string;
  album: string;
  albumArtist: string;
  year: number;
  trackCount: number;
  durationSec: number;
  artId: string;
  coverSrc: string;
  accentHex: string;
}

export interface AlbumPage {
  albums: Album[];
  total: number;
}

export interface Artist {
  name: string;
  trackCount: number;
  albumCount: number;
  artId: string;
  coverSrc: string;
  accentHex: string;
}

export interface ArtistPage {
  artists: Artist[];
  total: number;
}

export interface Genre {
  name: string;
  trackCount: number;
}

export interface SearchResults {
  tracks: Track[];
  albums: Album[];
  artists: Artist[];
}

export interface LibraryStats {
  tracks: number;
  albums: number;
  artists: number;
  genres: number;
  folders: number;
  liked: number;
  missing: number;
  durationMs: number;
  lastScanAt: number;
  cacheBytes: number;
}

export interface ScanIssue {
  path: string;
  message: string;
}

export interface ScanProgress {
  phase: string;
  done: number;
  total: number;
  currentPath: string;
  folderId: number;
  folderPath: string;
}

export interface ScanSummary {
  folderId: number;
  folderPath: string;
  added: number;
  updated: number;
  removed: number;
  missing: number;
  skipped: number;
  errors: ScanIssue[];
  canceled: boolean;
  startedAt: number;
  finishedAt: number;
}

export interface ScanStatus {
  running: boolean;
  progress: ScanProgress;
  last?: ScanSummary | null;
}

export interface Playlist {
  id: number;
  name: string;
  trackIds: number[];
  coverSrc: string;
  createdAt: number;
  updatedAt: number;
}

/** Shape accepted by the Go one-time playlist import. */
export interface PlaylistImport {
  name: string;
  trackIds: number[];
  createdAt: number;
}

/** Result of registering files or folders dropped onto the window. */
export interface FolderImportResult {
  folders: Folder[];
  added: string[];
  existing: string[];
  warnings: string[];
}

/** Emitted by Go after a native file drop has been handled. */
export interface LibraryDrop {
  result: FolderImportResult;
  error?: string;
  scanStarted: boolean;
}
