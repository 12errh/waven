export type TopTab = 'Discover' | 'Playlists' | 'Artists' | 'Albums' | 'Genres';

export type DockSection = 'home' | 'search' | 'library' | 'likes' | 'profile';

export type RepeatMode = 'off' | 'all' | 'one';

/**
 * Optional browser-preview accompaniment. Real library tracks always carry an
 * audio URL from the loopback media server, so the synth is only used by the
 * fixture library that keeps `npm run dev` usable outside the Wails shell.
 */
export interface SynthProfile {
  bpm: number;
  rootHz: number;
  chords: number[][];
  padColor: 'warm' | 'bright' | 'nocturnal';
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
  synth?: SynthProfile;
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
  id: string;
  name: string;
  description: string;
  trackIds: number[];
  coverSrc: string;
  createdAt: number;
}
