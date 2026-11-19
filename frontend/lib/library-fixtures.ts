'use client';

import { CATALOG_IMAGES } from './catalog-images';
import type {
  Album,
  AlbumPage,
  Artist,
  ArtistPage,
  Folder,
  Genre,
  LibraryStats,
  MixKind,
  ScanProgress,
  ScanStatus,
  ScanSummary,
  SearchResults,
  Track,
  TrackPage,
  TrackQuery,
} from './types';

/**
 * The fixture library keeps `npm run dev` useful in a plain browser, where the
 * Wails bridge does not exist. It is only selected after the real bindings
 * fail a probe, so it can never mask a desktop library.
 */

const LIKES_KEY = 'waven_preview_likes_v1';
const PREVIEW_ROOT = '/Music/Waven Preview';

const FIXTURE_TRACKS: Track[] = [
  fixtureTrack(1, 'Flowers', 'Miley Cyrus', 'Endless Summer Vacation', 'Pop', 2024, 192, CATALOG_IMAGES.flowers, 'mp3', 1, 1),
  fixtureTrack(2, 'Manchild', 'Sabrina Carpenter', 'Manchild', 'Pop', 2025, 210, CATALOG_IMAGES.champagne, 'flac', 1, 1),
  fixtureTrack(3, 'Sports Car', 'Tate McRae', 'So Close To What', 'Dance-Pop', 2025, 210, CATALOG_IMAGES.motorsport, 'm4a', 1, 1),
  fixtureTrack(4, 'Die With A Smile', 'Lady Gaga & Bruno Mars', 'Die With A Smile', 'Soul-Pop', 2024, 250, CATALOG_IMAGES.technicolor, 'mp3', 1, 1),
  fixtureTrack(5, 'Lunch', 'Billie Eilish', 'HIT ME HARD AND SOFT', 'Alt-Pop', 2024, 180, CATALOG_IMAGES.taupe, 'flac', 11, 1),
  fixtureTrack(6, 'Love On', 'Selena Gomez', 'Love On', 'Pop', 2024, 184, CATALOG_IMAGES.prism, 'm4a', 1, 1),
  fixtureTrack(7, 'Houdini', 'Dua Lipa', 'Radical Optimism', 'Synth-Pop', 2024, 186, CATALOG_IMAGES.convertible, 'mp3', 1, 1),
  fixtureTrack(8, 'Golden Silence', 'Billie Eilish', 'HIT ME HARD AND SOFT', 'Indie', 2024, 210, CATALOG_IMAGES.taupe, 'flac', 12, 1),
  fixtureTrack(9, 'Night Drive', 'The Waven Project', 'After Hours', 'Electronic', 2026, 224, CATALOG_IMAGES.convertible, 'opus', 1, 1),
  fixtureTrack(10, 'Low Orbit', 'The Waven Project', 'After Hours', 'Electronic', 2026, 198, CATALOG_IMAGES.prism, 'opus', 2, 1),
].map((track, index) => ({ ...track, addedAt: 1_760_000_000_000 - index * 60_000 }));

function fixtureTrack(
  id: number,
  title: string,
  artist: string,
  album: string,
  genre: string,
  year: number,
  durationSec: number,
  coverSrc: string,
  format: string,
  trackNo: number,
  discNo: number
): Track {
  return {
    id,
    title,
    artist,
    album,
    albumArtist: artist,
    genre,
    year,
    trackNo,
    discNo,
    durationMs: durationSec * 1000,
    durationSec,
    bitrateKbps: format === 'flac' ? 900 : 320,
    sampleRate: 44100,
    channels: 2,
    format,
    sizeBytes: format === 'flac' ? 8_000_000 : 3_500_000,
    artId: `preview-${id}`,
    coverSrc,
    accentHex: '#8a7a63',
    audioUrl: '',
    liked: false,
    missing: false,
    addedAt: 0,
  };
}

function readLikes(): Set<number> {
  if (typeof window === 'undefined') return new Set([1, 5]);
  try {
    const raw = window.localStorage.getItem(LIKES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) return new Set(parsed.filter((id) => typeof id === 'number'));
    }
  } catch {
    // Preview-only state; ignore storage failures.
  }
  return new Set([1, 5]);
}

function writeLikes(ids: Set<number>) {
  try {
    window.localStorage.setItem(LIKES_KEY, JSON.stringify(Array.from(ids)));
  } catch {
    // ignore
  }
}

function matchesText(track: Track, text: string): boolean {
  if (!text) return true;
  const needle = text.toLowerCase();
  return [track.title, track.artist, track.album, track.genre]
    .join(' ')
    .toLowerCase()
    .includes(needle);
}

function sortTracks(tracks: Track[], sort: string): Track[] {
  const copy = [...tracks];
  switch (sort) {
    case 'added':
      return copy.sort((a, b) => b.addedAt - a.addedAt);
    case 'title':
      return copy.sort((a, b) => a.title.localeCompare(b.title));
    case 'album':
      return copy.sort(
        (a, b) =>
          a.album.localeCompare(b.album) ||
          a.albumArtist.localeCompare(b.albumArtist) ||
          a.discNo - b.discNo ||
          a.trackNo - b.trackNo
      );
    case 'album_order':
      return copy.sort((a, b) => a.discNo - b.discNo || a.trackNo - b.trackNo);
    case 'duration':
      return copy.sort((a, b) => b.durationSec - a.durationSec);
    default:
      return copy.sort(
        (a, b) =>
          a.artist.localeCompare(b.artist) ||
          a.album.localeCompare(b.album) ||
          a.discNo - b.discNo ||
          a.trackNo - b.trackNo
      );
  }
}

export function createFixtureApi() {
  const tracks = FIXTURE_TRACKS.map((track) => ({ ...track }));
  const likes = readLikes();
  for (const track of tracks) track.liked = likes.has(track.id);
  const folders: Folder[] = [
    {
      id: 1,
      path: PREVIEW_ROOT,
      createdAt: 1_759_000_000_000,
      lastScanAt: 1_760_000_000_000,
    },
  ];
  let lastSummary: ScanSummary | null = null;
  let running = false;
  let progress: ScanProgress = emptyProgress();
  let ticker: ReturnType<typeof setInterval> | null = null;
  let doneTimer: ReturnType<typeof setTimeout> | null = null;
  const progressListeners = new Set<(p: ScanProgress) => void>();
  const doneListeners = new Set<(s: ScanSummary) => void>();

  function emitProgress(p: ScanProgress) {
    progress = p;
    for (const listener of progressListeners) listener(p);
  }

  function finish(summary: ScanSummary) {
    running = false;
    lastSummary = summary;
    progress = emptyProgress();
    for (const listener of doneListeners) listener(summary);
  }

  function stopTimers() {
    if (ticker !== null) clearInterval(ticker);
    if (doneTimer !== null) clearTimeout(doneTimer);
    ticker = null;
    doneTimer = null;
  }

  function startScan(folder: Folder) {
    if (running) throw new Error('a scan is already running');
    stopTimers();
    running = true;
    const startedAt = Date.now();
    let done = 0;
    emitProgress({
      phase: 'discovering',
      done: 0,
      total: 0,
      currentPath: folder.path,
      folderId: folder.id,
      folderPath: folder.path,
    });
    ticker = setInterval(() => {
      done += 2;
      if (done <= tracks.length) {
        emitProgress({
          phase: 'scanning',
          done,
          total: tracks.length,
          currentPath: `${folder.path}/${tracks[done - 1]?.title ?? 'track'}.${tracks[done - 1]?.format ?? 'mp3'}`,
          folderId: folder.id,
          folderPath: folder.path,
        });
        return;
      }
      if (ticker !== null) clearInterval(ticker);
      ticker = null;
      emitProgress({
        phase: 'finalizing',
        done: tracks.length,
        total: tracks.length,
        currentPath: '',
        folderId: folder.id,
        folderPath: folder.path,
      });
      doneTimer = setTimeout(() => {
        doneTimer = null;
        finish({
          folderId: folder.id,
          folderPath: folder.path,
          added: 0,
          updated: 0,
          removed: 0,
          missing: 0,
          skipped: tracks.length,
          errors: [],
          canceled: false,
          startedAt,
          finishedAt: Date.now(),
        });
      }, 400);
    }, 220);
  }

  function filterTracks(query: Partial<TrackQuery>): Track[] {
    return tracks.filter(
      (track) =>
        (!query.likedOnly || track.liked) &&
        (!query.artist || track.artist === query.artist) &&
        (!query.album || track.album === query.album) &&
        (!query.albumArtist || track.albumArtist === query.albumArtist) &&
        (!query.genre || track.genre === query.genre) &&
        matchesText(track, query.text ?? '')
    );
  }

  function albumsFrom(source: Track[]): Album[] {
    const map = new Map<string, Track[]>();
    for (const track of source) {
      const key = `${track.albumArtist}::${track.album}`;
      map.set(key, [...(map.get(key) ?? []), track]);
    }
    return Array.from(map.entries()).map(([id, group]) => ({
      id,
      album: group[0].album,
      albumArtist: group[0].albumArtist,
      year: group[0].year,
      trackCount: group.length,
      durationSec: group.reduce((sum, track) => sum + track.durationSec, 0),
      artId: group[0].artId,
      coverSrc: group[0].coverSrc,
      accentHex: group[0].accentHex,
    }));
  }

  function artistsFrom(source: Track[]): Artist[] {
    const map = new Map<string, Track[]>();
    for (const track of source) {
      map.set(track.artist, [...(map.get(track.artist) ?? []), track]);
    }
    return Array.from(map.entries()).map(([name, group]) => ({
      name,
      trackCount: group.length,
      albumCount: new Set(group.map((track) => track.album)).size,
      artId: group[0].artId,
      coverSrc: group[0].coverSrc,
      accentHex: group[0].accentHex,
    }));
  }

  function genresFrom(source: Track[]): Genre[] {
    const map = new Map<string, number>();
    for (const track of source) {
      if (track.genre) map.set(track.genre, (map.get(track.genre) ?? 0) + 1);
    }
    return Array.from(map.entries())
      .map(([name, trackCount]) => ({ name, trackCount }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  return {
    preview: true as const,
    async getTracks(query: TrackQuery): Promise<TrackPage> {
      const filtered = sortTracks(filterTracks(query), query.sort);
      const offset = Math.max(0, query.offset);
      const limit = query.limit > 0 ? query.limit : 500;
      return {
        tracks: filtered.slice(offset, offset + limit).map((track) => ({ ...track })),
        total: filtered.length,
      };
    },
    async getAlbums(limit: number, offset: number): Promise<AlbumPage> {
      const all = albumsFrom(tracks).sort((a, b) => a.album.localeCompare(b.album));
      return { albums: all.slice(offset, offset + (limit || all.length)), total: all.length };
    },
    async getArtists(limit: number, offset: number): Promise<ArtistPage> {
      const all = artistsFrom(tracks).sort((a, b) => a.name.localeCompare(b.name));
      return { artists: all.slice(offset, offset + (limit || all.length)), total: all.length };
    },
    async getGenres(): Promise<Genre[]> {
      return genresFrom(tracks);
    },
    async getStats(): Promise<LibraryStats> {
      return {
        tracks: tracks.length,
        albums: albumsFrom(tracks).length,
        artists: artistsFrom(tracks).length,
        genres: genresFrom(tracks).length,
        folders: folders.length,
        liked: tracks.filter((track) => track.liked).length,
        missing: 0,
        durationMs: tracks.reduce((sum, track) => sum + track.durationMs, 0),
        lastScanAt: lastSummary?.finishedAt ?? 1_760_000_000_000,
        cacheBytes: 12_400_000,
      };
    },
    async getFolders(): Promise<Folder[]> {
      return folders.map((folder) => ({ ...folder }));
    },
    async pickFolder(): Promise<string> {
      const candidates = [PREVIEW_ROOT, '/Music/Waven Preview Two', '/Music/Waven Preview Three'];
      return candidates.find((path) => !folders.some((folder) => folder.path === path)) ?? '';
    },
    async addFolder(path: string): Promise<Folder> {
      const clean = path.replace(/[\\/]+$/, '');
      if (!clean) throw new Error('choose a folder');
      const existing = folders.find((folder) => folder.path === clean);
      if (existing) return existing;
      if (folders.some((folder) => clean.startsWith(folder.path))) {
        throw new Error('this folder is already covered by a registered root');
      }
      const folder: Folder = { id: folders.length + 1, path: clean, createdAt: Date.now(), lastScanAt: null };
      folders.push(folder);
      return folder;
    },
    async removeFolder(id: number): Promise<void> {
      if (running) throw new Error('wait for the current scan to finish or cancel it first');
      const index = folders.findIndex((folder) => folder.id === id);
      if (index >= 0) folders.splice(index, 1);
    },
    async rescan(folderID: number): Promise<void> {
      const folder = folders.find((entry) => folderID === 0 || entry.id === folderID);
      if (!folder) throw new Error('add a music folder before scanning');
      startScan(folder);
    },
    async cancelScan(): Promise<void> {
      if (!running) return;
      const folderId = progress.folderId;
      const folderPath = progress.folderPath;
      stopTimers();
      running = false;
      progress = emptyProgress();
      const summary: ScanSummary = {
        folderId,
        folderPath,
        added: 0,
        updated: 0,
        removed: 0,
        missing: 0,
        skipped: 0,
        errors: [],
        canceled: true,
        startedAt: Date.now(),
        finishedAt: Date.now(),
      };
      lastSummary = summary;
      for (const listener of doneListeners) listener(summary);
    },
    async scanStatus(): Promise<ScanStatus> {
      return { running, progress: { ...progress }, last: lastSummary };
    },
    async getLikedIds(): Promise<number[]> {
      return tracks.filter((track) => track.liked).map((track) => track.id);
    },
    async getMix(kind: MixKind, limit: number): Promise<Track[]> {
      const cap = limit > 0 ? limit : 100;
      // Preview play history is synthetic so Discover has representative
      // content without a database. The desktop build uses real play rows.
      let source: Track[];
      switch (kind) {
        case 'recently_played':
          source = tracks.slice(0, 6);
          break;
        case 'on_repeat':
          source = tracks.slice(2, 8);
          break;
        case 'favorites':
          source = tracks.filter((track) => track.liked);
          break;
        case 'recently_added':
        default:
          source = sortTracks(tracks, 'added');
          break;
      }
      return source.slice(0, cap).map((track) => ({ ...track }));
    },
    async getTrack(id: number): Promise<Track> {
      const track = tracks.find((entry) => entry.id === id);
      if (!track) throw new Error('track not found');
      return { ...track };
    },
    async setLiked(id: number, liked: boolean): Promise<void> {
      const track = tracks.find((entry) => entry.id === id);
      if (!track) return;
      track.liked = liked;
      const ids = new Set(tracks.filter((entry) => entry.liked).map((entry) => entry.id));
      writeLikes(ids);
    },
    async search(query: string, limit: number): Promise<SearchResults> {
      const text = query.trim();
      if (!text) return { tracks: [], albums: [], artists: [] };
      const hits = sortTracks(filterTracks({ text }), 'title').slice(0, limit || 100);
      return { tracks: hits, albums: albumsFrom(hits), artists: artistsFrom(hits) };
    },
    async setDuration(id: number, durationMs: number): Promise<void> {
      const track = tracks.find((entry) => entry.id === id);
      if (!track) return;
      track.durationMs = durationMs;
      track.durationSec = durationMs / 1000;
    },
    onScanProgress(listener: (p: ScanProgress) => void): () => void {
      progressListeners.add(listener);
      return () => progressListeners.delete(listener);
    },
    onScanDone(listener: (s: ScanSummary) => void): () => void {
      doneListeners.add(listener);
      return () => doneListeners.delete(listener);
    },
  };
}

function emptyProgress(): ScanProgress {
  return {
    phase: 'idle',
    done: 0,
    total: 0,
    currentPath: '',
    folderId: 0,
    folderPath: '',
  };
}

export type FixtureLibraryApi = ReturnType<typeof createFixtureApi>;
