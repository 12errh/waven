import type { Playlist, RepeatMode, Track } from './types';

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
 * Formats large integer likes counts cleanly (e.g. 2800000 -> "2.8M likes").
 */
export function formatLikesCount(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return '0 likes';
  if (count >= 1_000_000) {
    const val = (count / 1_000_000).toFixed(1).replace(/\.0$/, '');
    return `${val}M likes`;
  }
  if (count >= 1_000) {
    const val = (count / 1_000).toFixed(1).replace(/\.0$/, '');
    return `${val}K likes`;
  }
  return `${count} likes`;
}

/**
 * Computes the next track ID given the current queue, active ID, shuffle, and repeat settings.
 */
export function getNextTrackId(params: {
  queueIds: string[];
  currentTrackId: string;
  shuffle: boolean;
  repeat: RepeatMode;
  randomFn?: () => number;
}): string | null {
  const { queueIds, currentTrackId, shuffle, repeat, randomFn = Math.random } = params;
  if (queueIds.length === 0) return null;
  if (repeat === 'one') return currentTrackId;

  const currentIdx = queueIds.indexOf(currentTrackId);

  if (shuffle && queueIds.length > 1) {
    const candidates = queueIds.filter((id) => id !== currentTrackId);
    const pickIdx = Math.floor(randomFn() * candidates.length);
    return candidates[Math.max(0, Math.min(candidates.length - 1, pickIdx))];
  }

  if (currentIdx === -1) return queueIds[0];
  if (currentIdx < queueIds.length - 1) return queueIds[currentIdx + 1];

  return repeat === 'all' ? queueIds[0] : queueIds[0];
}

/**
 * Computes the previous track ID given the current queue and elapsed playback seconds.
 * If elapsed > 3 seconds, callers restart current track; otherwise step back.
 */
export function getPrevTrackId(params: {
  queueIds: string[];
  currentTrackId: string;
}): string | null {
  const { queueIds, currentTrackId } = params;
  if (queueIds.length === 0) return null;
  const currentIdx = queueIds.indexOf(currentTrackId);
  if (currentIdx <= 0) return queueIds[queueIds.length - 1];
  return queueIds[currentIdx - 1];
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
  trackId: string
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
  trackId: string
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
