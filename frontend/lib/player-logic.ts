import type { Playlist, PlayerSession, RepeatMode, Track } from './types';

/**
 * Formats seconds as MM:SS with zero-padded minutes and seconds (e.g. 00:43, 03:12).
 */
export function formatTimeMMSS(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const total = Math.floor(seconds);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/**
 * Formats seconds as compact M:SS for tracklist rows (e.g. 3:30).
 */
export function formatTrackRowDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

/**
 * Formats a library duration in hours and minutes for the profile summary.
 */
export function formatLibraryDuration(totalMs: number): string {
  if (!Number.isFinite(totalMs) || totalMs <= 0) return '0 min';
  const minutes = Math.round(totalMs / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}

/**
 * Formats the technical metadata of a local file for compact display, e.g.
 * "FLAC · 44.1 kHz · 900 kbps". Unknown values are skipped.
 */
export function formatTrackQuality(track: {
  format: string;
  sampleRate: number;
  bitrateKbps: number;
  channels: number;
}): string {
  const parts: string[] = [];
  if (track.format) parts.push(track.format.toUpperCase());
  if (track.sampleRate > 0) {
    parts.push(`${(track.sampleRate / 1000).toFixed(track.sampleRate % 1000 === 0 ? 0 : 1)} kHz`);
  }
  if (track.bitrateKbps > 0) parts.push(`${Math.round(track.bitrateKbps)} kbps`);
  if (track.channels === 1) parts.push('mono');
  return parts.join(' · ');
}

/**
 * Formats a byte count for the library cache summary.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (mb < 1024) return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

/**
 * Formats a unix-millisecond timestamp as a short relative label.
 */
export function formatRelativeTime(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return 'never';
  const deltaMs = Date.now() - timestamp;
  if (deltaMs < 60_000) return 'just now';
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} ${days === 1 ? 'day' : 'days'} ago`;
  return new Date(timestamp).toLocaleDateString();
}

/**
 * Builds a stable shuffle order for a queue. The active track is placed first
 * so toggling shuffle never changes what is playing; the rest are shuffled with
 * a Fisher-Yates pass. The order is persisted in the session so next/previous
 * stay predictable across restarts.
 */
export function buildShuffleOrder(
  queueIds: number[],
  currentTrackId: number | null,
  randomFn: () => number = Math.random
): number[] {
  const unique = dedupeIds(queueIds);
  if (unique.length === 0) return [];
  const rest = unique.filter((id) => id !== currentTrackId);
  for (let index = rest.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(randomFn() * (index + 1));
    [rest[index], rest[swap]] = [rest[swap], rest[index]];
  }
  return currentTrackId !== null && unique.includes(currentTrackId)
    ? [currentTrackId, ...rest]
    : rest;
}

/**
 * Returns the order playback follows. Shuffle uses the saved order, dropping
 * removed tracks and appending tracks added later; sequential playback follows
 * the queue itself.
 */
export function getPlaybackOrder(
  queueIds: number[],
  shuffle: boolean,
  shuffleOrder: number[]
): number[] {
  if (!shuffle) return queueIds;
  const queued = new Set(queueIds);
  const order: number[] = [];
  const seen = new Set<number>();
  for (const id of shuffleOrder) {
    if (queued.has(id) && !seen.has(id)) {
      order.push(id);
      seen.add(id);
    }
  }
  for (const id of queueIds) {
    if (!seen.has(id)) {
      order.push(id);
      seen.add(id);
    }
  }
  return order;
}

/**
 * Computes the next track ID for the current queue and playback mode.
 *
 * `autoAdvance` distinguishes a natural track ending from a manual next press:
 * repeat-one only replays on a natural ending, while an explicit next always
 * moves on. Repeat-off returns null at the end of the order.
 */
export function getNextTrackId(params: {
  queueIds: number[];
  currentTrackId: number;
  shuffle: boolean;
  repeat: RepeatMode;
  shuffleOrder?: number[];
  autoAdvance?: boolean;
  randomFn?: () => number;
}): number | null {
  const {
    queueIds,
    currentTrackId,
    shuffle,
    repeat,
    shuffleOrder = [],
    autoAdvance = false,
    randomFn = Math.random,
  } = params;
  if (queueIds.length === 0) return null;
  if (repeat === 'one' && autoAdvance) return currentTrackId;

  const order =
    shuffle && shuffleOrder.length > 0
      ? getPlaybackOrder(queueIds, true, shuffleOrder)
      : shuffle
        ? buildShuffleOrder(queueIds, currentTrackId, randomFn)
        : queueIds;
  if (order.length === 0) return null;

  const currentIdx = order.indexOf(currentTrackId);
  if (currentIdx === -1) return order[0];
  if (currentIdx < order.length - 1) return order[currentIdx + 1];
  return repeat === 'all' ? order[0] : null;
}

/**
 * Computes the previous track ID. At the top of the queue repeat-all wraps to
 * the end; otherwise callers restart the current track.
 */
export function getPrevTrackId(params: {
  queueIds: number[];
  currentTrackId: number;
  shuffle?: boolean;
  shuffleOrder?: number[];
  repeat?: RepeatMode;
}): number | null {
  const {
    queueIds,
    currentTrackId,
    shuffle = false,
    shuffleOrder = [],
    repeat = 'off',
  } = params;
  if (queueIds.length === 0) return null;
  const order = getPlaybackOrder(queueIds, shuffle, shuffleOrder);
  if (order.length === 0) return null;
  const currentIdx = order.indexOf(currentTrackId);
  if (currentIdx === -1) return order[0];
  if (currentIdx > 0) return order[currentIdx - 1];
  return repeat === 'all' && order.length > 1 ? order[order.length - 1] : null;
}

/** Removes duplicate and non-positive ids while preserving order. */
export function dedupeIds(ids: number[]): number[] {
  const seen = new Set<number>();
  const unique: number[] = [];
  for (const id of ids) {
    if (!Number.isFinite(id) || id <= 0 || seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
  }
  return unique;
}

/**
 * Coerces a stored or partially built session into the shape the player and
 * the Go store expect. Unknown repeat values fall back to `off`; the active
 * track is kept only when it is part of the queue.
 */
export function normalizePlayerSession(raw: Partial<PlayerSession> | null | undefined): PlayerSession {
  const queueIds = dedupeIds(Array.isArray(raw?.queueIds) ? raw.queueIds : []);
  const repeat: RepeatMode =
    raw?.repeat === 'all' || raw?.repeat === 'one' ? raw.repeat : 'off';
  const volume = Number(raw?.volume);
  const positionMs = Number(raw?.positionMs);
  let trackId = Number(raw?.trackId) > 0 ? Math.trunc(Number(raw?.trackId)) : 0;
  if (queueIds.length > 0 && !queueIds.includes(trackId)) trackId = queueIds[0];
  if (queueIds.length === 0) trackId = 0;

  const shuffle = Boolean(raw?.shuffle);
  let shuffleOrder = dedupeIds(
    Array.isArray(raw?.shuffleOrder) ? raw.shuffleOrder : []
  ).filter((id) => queueIds.includes(id));
  if (shuffle) {
    if (shuffleOrder.length === 0 && queueIds.length > 0) {
      // Older sessions may not have stored an order. Build one that starts
      // from the active track so enabling shuffle never jumps playback.
      shuffleOrder = buildShuffleOrder(queueIds, trackId > 0 ? trackId : null);
    } else {
      // Preserve the saved order exactly. Moving the current track to the
      // front would silently change which track "next" and "previous" mean.
      const seen = new Set(shuffleOrder);
      for (const id of queueIds) {
        if (!seen.has(id)) {
          shuffleOrder.push(id);
          seen.add(id);
        }
      }
    }
  }

  return {
    trackId,
    positionMs: Number.isFinite(positionMs) ? Math.max(0, Math.round(positionMs)) : 0,
    queueIds,
    queueIndex: Math.max(0, queueIds.indexOf(trackId)),
    shuffle,
    shuffleOrder,
    repeat,
    volume: Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 0.8,
    muted: Boolean(raw?.muted),
    updatedAt: Number(raw?.updatedAt) > 0 ? Math.trunc(Number(raw?.updatedAt)) : 0,
  };
}

/**
 * Clamps a resumed position before the end of the track, leaving two seconds
 * so playback never restores in an immediately-ended state.
 */
export function clampResumeSeconds(positionMs: number, durationSec: number): number {
  const position = Number.isFinite(positionMs) ? Math.max(0, positionMs / 1000) : 0;
  if (!Number.isFinite(durationSec) || durationSec <= 0) return position;
  const limit = Math.max(0, durationSec - 2);
  return Math.min(position, limit);
}

/**
 * The position at which a listen counts as a play: 30 seconds or half the
 * track, whichever comes first.
 */
export function playRecordThresholdSeconds(durationSec: number): number {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return 30;
  return Math.min(30, durationSec / 2);
}

/**
 * Filters tracks by query text across title, artist, album, and genre.
 */
export function filterTracksByQuery(tracks: Track[], query: string): Track[] {
  const q = query.trim().toLowerCase();
  if (!q) return tracks;
  return tracks.filter(
    (t) =>
      t.title.toLowerCase().includes(q) ||
      t.artist.toLowerCase().includes(q) ||
      t.album.toLowerCase().includes(q) ||
      t.genre.toLowerCase().includes(q)
  );
}

/**
 * Filters tracks by genre name (case-insensitive, 'All' returns everything).
 */
export function filterTracksByGenre(tracks: Track[], genre: string): Track[] {
  if (!genre || genre === 'All') return tracks;
  return tracks.filter((t) => t.genre.toLowerCase() === genre.toLowerCase());
}

/**
 * Groups tracks by artist with aggregate counts and cover artwork.
 */
export function groupTracksByArtist(tracks: Track[]): Array<{
  artist: string;
  trackCount: number;
  coverSrc: string;
  tracks: Track[];
}> {
  const map = new Map<string, Track[]>();
  for (const track of tracks) {
    const existing = map.get(track.artist) ?? [];
    existing.push(track);
    map.set(track.artist, existing);
  }
  return Array.from(map.entries()).map(([artist, artistTracks]) => ({
    artist,
    trackCount: artistTracks.length,
    coverSrc: artistTracks[0].coverSrc,
    tracks: artistTracks,
  }));
}

/**
 * Groups tracks by album with artist, year, and cover artwork.
 */
export function groupTracksByAlbum(tracks: Track[]): Array<{
  album: string;
  artist: string;
  year: number;
  coverSrc: string;
  tracks: Track[];
}> {
  const map = new Map<string, Track[]>();
  for (const track of tracks) {
    const key = `${track.album}::${track.artist}`;
    const existing = map.get(key) ?? [];
    existing.push(track);
    map.set(key, existing);
  }
  return Array.from(map.values()).map((albumTracks) => ({
    album: albumTracks[0].album,
    artist: albumTracks[0].artist,
    year: albumTracks[0].year,
    coverSrc: albumTracks[0].coverSrc,
    tracks: albumTracks,
  }));
}

/**
 * Adds a track ID to a playlist without duplicating if already present.
 */
export function addTrackToPlaylist(
  playlists: Playlist[],
  playlistId: string,
  trackId: number
): Playlist[] {
  return playlists.map((pl) => {
    if (pl.id !== playlistId) return pl;
    if (pl.trackIds.includes(trackId)) return pl;
    return { ...pl, trackIds: [...pl.trackIds, trackId] };
  });
}

/**
 * Removes a track ID from a playlist.
 */
export function removeTrackFromPlaylist(
  playlists: Playlist[],
  playlistId: string,
  trackId: number
): Playlist[] {
  return playlists.map((pl) => {
    if (pl.id !== playlistId) return pl;
    return { ...pl, trackIds: pl.trackIds.filter((id) => id !== trackId) };
  });
}

/**
 * Clamps progress percentage [0, 100] and converts to seek seconds.
 */
export function computeSeekTime(ratio: number, durationSec: number): number {
  const clamped = Math.max(0, Math.min(1, ratio));
  return Math.round(clamped * Math.max(0, durationSec));
}
