'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getLibraryApi, type LibraryApi } from './library-api';
import type {
  AlbumPage,
  ArtistPage,
  Folder,
  Genre,
  LibraryDrop,
  LibraryStats,
  MixKind,
  Playlist,
  PlaylistImport,
  ScanProgress,
  ScanSummary,
  SearchResults,
  Track,
  TrackPage,
  TrackQuery,
} from './types';

export const EMPTY_STATS: LibraryStats = {
  tracks: 0,
  albums: 0,
  artists: 0,
  genres: 0,
  folders: 0,
  liked: 0,
  missing: 0,
  durationMs: 0,
  lastScanAt: 0,
  cacheBytes: 0,
};

export const IDLE_PROGRESS: ScanProgress = {
  phase: 'idle',
  done: 0,
  total: 0,
  currentPath: '',
  folderId: 0,
  folderPath: '',
};

export interface ScanState {
  running: boolean;
  progress: ScanProgress;
  last: ScanSummary | null;
}

export interface LibraryController {
  ready: boolean;
  /** True when the browser fixture stands in for the Wails bridge. */
  preview: boolean;
  error: string | null;
  clearError: () => void;
  folders: Folder[];
  stats: LibraryStats;
  recent: Track[];
  recentTotal: number;
  likes: Set<number>;
  playlists: Playlist[];
  /** Most recent native file drop, for the toast layer. */
  drop: LibraryDrop | null;
  clearDrop: () => void;
  scan: ScanState;
  /** Bumped after scans and folder changes so tab data reloads. */
  revision: number;
  loadTracks: (query: Partial<TrackQuery>) => Promise<TrackPage>;
  loadAlbums: (limit?: number, offset?: number) => Promise<AlbumPage>;
  loadArtists: (limit?: number, offset?: number) => Promise<ArtistPage>;
  loadGenres: () => Promise<Genre[]>;
  loadMix: (kind: MixKind, limit?: number) => Promise<Track[]>;
  search: (query: string) => Promise<SearchResults>;
  resolveTrack: (id: number | null | undefined) => Track | undefined;
  getTrack: (id: number) => Promise<Track | undefined>;
  hydrateTracks: (ids: number[]) => Promise<void>;
  refresh: () => Promise<void>;
  addFolder: () => Promise<boolean>;
  removeFolder: (id: number) => Promise<void>;
  rescan: (folderID?: number) => Promise<void>;
  cancelScan: () => Promise<void>;
  toggleLike: (id: number) => Promise<void>;
  reportDuration: (id: number, seconds: number) => Promise<void>;
  createPlaylist: (name: string, trackIds?: number[]) => Promise<Playlist | null>;
  renamePlaylist: (id: number, name: string) => Promise<boolean>;
  deletePlaylist: (id: number) => Promise<boolean>;
  addTrackToPlaylist: (id: number, trackId: number) => Promise<boolean>;
  removeFromPlaylist: (id: number, trackId: number) => Promise<boolean>;
  reorderPlaylist: (id: number, trackIds: number[]) => Promise<boolean>;
  importLegacyPlaylists: (imports: PlaylistImport[]) => Promise<number>;
  importDroppedPaths: (paths: string[]) => Promise<void>;
}

const RECENT_LIMIT = 60;

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return 'Something went wrong while talking to the library.';
}

function recentQuery(): TrackQuery {
  return {
    text: '',
    artist: '',
    album: '',
    albumArtist: '',
    genre: '',
    likedOnly: false,
    sort: 'added',
    limit: RECENT_LIMIT,
    offset: 0,
  };
}

/**
 * Owns the library connection, folder/scan state, and the track index shared by
 * the player, queue, search, and playlists. Views load their own pages through
 * the controller so a 50k-track library never has to be fully materialized.
 */
export function useLibrary(): LibraryController {
  const [api, setApi] = useState<LibraryApi | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [stats, setStats] = useState<LibraryStats>(EMPTY_STATS);
  const [recent, setRecent] = useState<Track[]>([]);
  const [recentTotal, setRecentTotal] = useState(0);
  const [likes, setLikes] = useState<Set<number>>(new Set());
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [drop, setDrop] = useState<LibraryDrop | null>(null);
  const [scan, setScan] = useState<ScanState>({
    running: false,
    progress: IDLE_PROGRESS,
    last: null,
  });
  const [revision, setRevision] = useState(0);

  const indexRef = useRef(new Map<number, Track>());
  const requestedRef = useRef(new Set<number>());
  const likesRef = useRef(likes);
  const [, setIndexVersion] = useState(0);

  useEffect(() => {
    likesRef.current = likes;
  }, [likes]);

  const upsertTracks = useCallback((incoming: Track[]) => {
    if (incoming.length === 0) return;
    for (const track of incoming) {
      indexRef.current.set(track.id, track);
    }
    setIndexVersion((version) => version + 1);
  }, []);

  const mergeLike = useCallback((id: number, liked: boolean) => {
    const cached = indexRef.current.get(id);
    if (!cached) return;
    indexRef.current.set(id, { ...cached, liked });
    setRecent((current) =>
      current.map((track) => (track.id === id ? { ...track, liked } : track))
    );
    setIndexVersion((version) => version + 1);
  }, []);

  const refreshCollections = useCallback(
    async (client: LibraryApi) => {
      const [folderResult, statsResult, likedResult, recentResult, playlistResult] =
        await Promise.allSettled([
          client.getFolders(),
          client.getStats(),
          client.getLikedIds(),
          client.getTracks(recentQuery()),
          client.getPlaylists(),
        ]);
      if (folderResult.status === 'fulfilled') setFolders(folderResult.value);
      if (statsResult.status === 'fulfilled') setStats(statsResult.value);
      if (likedResult.status === 'fulfilled') setLikes(new Set(likedResult.value));
      if (recentResult.status === 'fulfilled') {
        setRecent(recentResult.value.tracks);
        setRecentTotal(recentResult.value.total);
        upsertTracks(recentResult.value.tracks);
      }
      if (playlistResult.status === 'fulfilled') setPlaylists(playlistResult.value);
      setRevision((value) => value + 1);
      const failure = [folderResult, statsResult, likedResult, recentResult, playlistResult].find(
        (result) => result.status === 'rejected'
      );
      if (failure && failure.status === 'rejected') {
        setError(errorMessage(failure.reason));
      }
    },
    [upsertTracks]
  );

  useEffect(() => {
    let closed = false;
    let offProgress: (() => void) | undefined;
    let offDone: (() => void) | undefined;
    let offDrop: (() => void) | undefined;

    void (async () => {
      try {
        const client = await getLibraryApi();
        if (closed) return;
        setApi(client);

        const [folderResult, statsResult, likedResult, statusResult, recentResult, playlistResult] =
          await Promise.allSettled([
            client.getFolders(),
            client.getStats(),
            client.getLikedIds(),
            client.scanStatus(),
            client.getTracks(recentQuery()),
            client.getPlaylists(),
          ]);
        if (closed) return;

        if (folderResult.status === 'fulfilled') setFolders(folderResult.value);
        if (statsResult.status === 'fulfilled') setStats(statsResult.value);
        if (likedResult.status === 'fulfilled') setLikes(new Set(likedResult.value));
        if (statusResult.status === 'fulfilled') {
          const status = statusResult.value;
          setScan({
            running: status.running,
            progress: status.progress ?? IDLE_PROGRESS,
            last: status.last ?? null,
          });
        }
        if (recentResult.status === 'fulfilled') {
          setRecent(recentResult.value.tracks);
          setRecentTotal(recentResult.value.total);
          upsertTracks(recentResult.value.tracks);
        }
        if (playlistResult.status === 'fulfilled') setPlaylists(playlistResult.value);
        const failure = [
          folderResult,
          statsResult,
          likedResult,
          statusResult,
          recentResult,
          playlistResult,
        ].find((result) => result.status === 'rejected');
        if (failure && failure.status === 'rejected') {
          setError(errorMessage(failure.reason));
        }

        offProgress = client.onScanProgress((progress) => {
          setScan((current) => ({
            ...current,
            running: progress.phase !== 'done' && progress.phase !== 'idle',
            progress,
          }));
        });
        offDone = client.onScanDone((summary) => {
          setScan({ running: false, progress: IDLE_PROGRESS, last: summary });
          void refreshCollections(client);
        });
        offDrop = client.onLibraryDrop((outcome) => {
          setDrop(outcome);
          if (outcome.result?.folders?.length) {
            setFolders((current) => {
              const seen = new Set(current.map((folder) => folder.id));
              return [...current, ...outcome.result.folders.filter((folder) => !seen.has(folder.id))];
            });
          }
          void refreshCollections(client);
        });

        setReady(true);
      } catch (loadError) {
        if (closed) return;
        setError(errorMessage(loadError));
        setReady(true);
      }
    })();

    return () => {
      closed = true;
      offProgress?.();
      offDone?.();
      offDrop?.();
    };
  }, [refreshCollections, upsertTracks]);

  const loadTracks = useCallback(
    async (query: Partial<TrackQuery>) => {
      if (!api) return { tracks: [], total: 0 };
      const page = await api.getTracks({ ...recentQuery(), ...query });
      upsertTracks(page.tracks);
      return page;
    },
    [api, upsertTracks]
  );

  const loadAlbums = useCallback(
    async (limit = 60, offset = 0): Promise<AlbumPage> => {
      if (!api) return { albums: [], total: 0 };
      return api.getAlbums(limit, offset);
    },
    [api]
  );

  const loadArtists = useCallback(
    async (limit = 60, offset = 0): Promise<ArtistPage> => {
      if (!api) return { artists: [], total: 0 };
      return api.getArtists(limit, offset);
    },
    [api]
  );

  const loadGenres = useCallback(async (): Promise<Genre[]> => {
    if (!api) return [];
    return api.getGenres();
  }, [api]);

  const loadMix = useCallback(
    async (kind: MixKind, limit = 100): Promise<Track[]> => {
      if (!api) return [];
      const mix = await api.getMix(kind, limit);
      upsertTracks(mix);
      return mix;
    },
    [api, upsertTracks]
  );

  const search = useCallback(
    async (query: string): Promise<SearchResults> => {
      if (!api) return { tracks: [], albums: [], artists: [] };
      const results = await api.search(query, 100);
      upsertTracks(results.tracks);
      return results;
    },
    [api, upsertTracks]
  );

  const resolveTrack = useCallback((id: number | null | undefined) => {
    if (id === null || id === undefined) return undefined;
    return indexRef.current.get(id);
  }, []);

  const getTrack = useCallback(
    async (id: number): Promise<Track | undefined> => {
      const cached = indexRef.current.get(id);
      if (cached) return cached;
      if (!api) return undefined;
      try {
        const track = await api.getTrack(id);
        upsertTracks([track]);
        return track;
      } catch {
        return undefined;
      }
    },
    [api, upsertTracks]
  );

  const hydrateTracks = useCallback(
    async (ids: number[]) => {
      if (!api) return;
      const missing = Array.from(new Set(ids)).filter(
        (id) => !indexRef.current.has(id) && !requestedRef.current.has(id)
      );
      if (missing.length === 0) return;
      for (const id of missing) requestedRef.current.add(id);
      const batchSize = 8;
      for (let index = 0; index < missing.length; index += batchSize) {
        const batch = missing.slice(index, index + batchSize);
        const results = await Promise.allSettled(batch.map((id) => api.getTrack(id)));
        upsertTracks(
          results
            .filter((result): result is PromiseFulfilledResult<Track> => result.status === 'fulfilled')
            .map((result) => result.value)
        );
        // A failed lookup is allowed to retry on the next hydration pass
        // instead of staying permanently unresolved.
        results.forEach((result, position) => {
          if (result.status === 'rejected') requestedRef.current.delete(batch[position]);
        });
      }
    },
    [api, upsertTracks]
  );

  const refresh = useCallback(async () => {
    if (!api) return;
    await refreshCollections(api);
  }, [api, refreshCollections]);

  const addFolder = useCallback(async () => {
    if (!api) return false;
    try {
      const path = await api.pickFolder();
      if (!path) return false;
      const folder = await api.addFolder(path);
      setFolders((current) =>
        current.some((entry) => entry.id === folder.id) ? current : [...current, folder]
      );
      await api.rescan(folder.id);
      setScan({
        running: true,
        progress: { ...IDLE_PROGRESS, phase: 'starting', folderId: folder.id, folderPath: folder.path },
        last: null,
      });
      setRevision((value) => value + 1);
      return true;
    } catch (addError) {
      setError(errorMessage(addError));
      return false;
    }
  }, [api]);

  const removeFolder = useCallback(
    async (id: number) => {
      if (!api) return;
      try {
        await api.removeFolder(id);
        await refreshCollections(api);
      } catch (removeError) {
        setError(errorMessage(removeError));
      }
    },
    [api, refreshCollections]
  );

  const rescan = useCallback(
    async (folderID = 0) => {
      if (!api) return;
      try {
        await api.rescan(folderID);
        setScan((current) => ({
          ...current,
          running: true,
          progress: { ...IDLE_PROGRESS, phase: 'starting', folderId: folderID },
        }));
      } catch (scanError) {
        setError(errorMessage(scanError));
      }
    },
    [api]
  );

  const cancelScan = useCallback(async () => {
    if (!api) return;
    try {
      await api.cancelScan();
    } catch (cancelError) {
      setError(errorMessage(cancelError));
    }
  }, [api]);

  const toggleLike = useCallback(
    async (id: number) => {
      if (!api) return;
      const wasLiked = likesRef.current.has(id);
      const nextLiked = !wasLiked;
      const applyLikes = (liked: boolean) => {
        const next = new Set(likesRef.current);
        if (liked) next.add(id);
        else next.delete(id);
        likesRef.current = next;
        setLikes(next);
        setStats((current) => ({
          ...current,
          liked: Math.max(0, current.liked + (liked === wasLiked ? 0 : liked ? 1 : -1)),
        }));
      };
      applyLikes(nextLiked);
      mergeLike(id, nextLiked);
      try {
        await api.setLiked(id, nextLiked);
      } catch (likeError) {
        applyLikes(wasLiked);
        mergeLike(id, wasLiked);
        setError(errorMessage(likeError));
      }
    },
    [api, mergeLike]
  );

  const reportDuration = useCallback(
    async (id: number, seconds: number) => {
      if (!api || !Number.isFinite(seconds) || seconds <= 0) return;
      const cached = indexRef.current.get(id);
      // Parsed header durations are trustworthy; only fill tracks that have none.
      if (cached && cached.durationMs > 500) return;
      const durationMs = Math.round(seconds * 1000);
      if (cached) {
        indexRef.current.set(id, { ...cached, durationMs, durationSec: seconds });
        setRecent((current) =>
          current.map((track) =>
            track.id === id ? { ...track, durationMs, durationSec: seconds } : track
          )
        );
        setIndexVersion((version) => version + 1);
      }
      try {
        await api.setDuration(id, durationMs);
        await refreshSilently(api, setStats);
      } catch {
        // A duration hint is optional; never interrupt playback for it.
      }
    },
    [api]
  );

  const clearError = useCallback(() => setError(null), []);

  const reloadPlaylists = useCallback(
    async (client?: LibraryApi) => {
      const target = client ?? api;
      if (!target) return;
      try {
        setPlaylists(await target.getPlaylists());
      } catch (playlistError) {
        setError(errorMessage(playlistError));
      }
    },
    [api]
  );

  const createPlaylist = useCallback(
    async (name: string, trackIds: number[] = []): Promise<Playlist | null> => {
      if (!api) return null;
      try {
        const playlist = await api.createPlaylist(name, trackIds);
        setPlaylists((current) => [
          playlist,
          ...current.filter((entry) => entry.id !== playlist.id),
        ]);
        return playlist;
      } catch (createError) {
        setError(errorMessage(createError));
        return null;
      }
    },
    [api]
  );

  const renamePlaylist = useCallback(
    async (id: number, name: string): Promise<boolean> => {
      if (!api) return false;
      const clean = name.trim();
      if (!clean) {
        setError('Playlist name cannot be empty.');
        return false;
      }
      try {
        await api.renamePlaylist(id, clean);
        setPlaylists((current) =>
          current.map((playlist) =>
            playlist.id === id
              ? { ...playlist, name: clean, updatedAt: Date.now() }
              : playlist
          )
        );
        return true;
      } catch (renameError) {
        setError(errorMessage(renameError));
        return false;
      }
    },
    [api]
  );

  const deletePlaylist = useCallback(
    async (id: number): Promise<boolean> => {
      if (!api) return false;
      try {
        await api.deletePlaylist(id);
        setPlaylists((current) => current.filter((playlist) => playlist.id !== id));
        return true;
      } catch (deleteError) {
        setError(errorMessage(deleteError));
        return false;
      }
    },
    [api]
  );

  const addTrackToPlaylist = useCallback(
    async (id: number, trackId: number): Promise<boolean> => {
      if (!api) return false;
      const cached = indexRef.current.get(trackId);
      setPlaylists((current) =>
        current.map((playlist) =>
          playlist.id === id && !playlist.trackIds.includes(trackId)
            ? {
                ...playlist,
                trackIds: [...playlist.trackIds, trackId],
                coverSrc: playlist.coverSrc || cached?.coverSrc || '',
                updatedAt: Date.now(),
              }
            : playlist
        )
      );
      try {
        await api.addTrackToPlaylist(id, trackId);
        return true;
      } catch (addError) {
        setError(errorMessage(addError));
        await reloadPlaylists(api);
        return false;
      }
    },
    [api, reloadPlaylists]
  );

  const removeFromPlaylist = useCallback(
    async (id: number, trackId: number): Promise<boolean> => {
      if (!api) return false;
      setPlaylists((current) =>
        current.map((playlist) => {
          if (playlist.id !== id) return playlist;
          const trackIds = playlist.trackIds.filter((entry) => entry !== trackId);
          return {
            ...playlist,
            trackIds,
            coverSrc: indexRef.current.get(trackIds[0] ?? -1)?.coverSrc ?? playlist.coverSrc,
            updatedAt: Date.now(),
          };
        })
      );
      try {
        await api.removeFromPlaylist(id, trackId);
        return true;
      } catch (removeError) {
        setError(errorMessage(removeError));
        await reloadPlaylists(api);
        return false;
      }
    },
    [api, reloadPlaylists]
  );

  const reorderPlaylist = useCallback(
    async (id: number, trackIds: number[]): Promise<boolean> => {
      if (!api) return false;
      setPlaylists((current) =>
        current.map((playlist) =>
          playlist.id === id
            ? { ...playlist, trackIds: [...trackIds], updatedAt: Date.now() }
            : playlist
        )
      );
      try {
        await api.reorderPlaylist(id, trackIds);
        return true;
      } catch (reorderError) {
        setError(errorMessage(reorderError));
        await reloadPlaylists(api);
        return false;
      }
    },
    [api, reloadPlaylists]
  );

  const importLegacyPlaylists = useCallback(
    async (imports: PlaylistImport[]): Promise<number> => {
      if (!api || imports.length === 0) return 0;
      try {
        const count = await api.importPlaylists(imports);
        if (count > 0) await reloadPlaylists(api);
        return count;
      } catch (importError) {
        setError(errorMessage(importError));
        return 0;
      }
    },
    [api, reloadPlaylists]
  );

  const importDroppedPaths = useCallback(
    async (paths: string[]) => {
      if (!api || paths.length === 0) return;
      try {
        const result = await api.importDroppedPaths(paths);
        setDrop({ result, scanStarted: false });
        await refreshCollections(api);
        if (result.added.length > 0) {
          await api.rescan(0);
          setScan((current) => ({
            ...current,
            running: true,
            progress: { ...IDLE_PROGRESS, phase: 'starting' },
          }));
        }
      } catch (dropError) {
        setError(errorMessage(dropError));
      }
    },
    [api, refreshCollections]
  );

  const clearDrop = useCallback(() => setDrop(null), []);

  return useMemo(
    () => ({
      ready,
      preview: api?.preview ?? false,
      error,
      clearError,
      folders,
      stats,
      recent,
      recentTotal,
      likes,
      playlists,
      drop,
      clearDrop,
      scan,
      revision,
      loadTracks,
      loadAlbums,
      loadArtists,
      loadGenres,
      loadMix,
      search,
      resolveTrack,
      getTrack,
      hydrateTracks,
      refresh,
      addFolder,
      removeFolder,
      rescan,
      cancelScan,
      toggleLike,
      reportDuration,
      createPlaylist,
      renamePlaylist,
      deletePlaylist,
      addTrackToPlaylist,
      removeFromPlaylist,
      reorderPlaylist,
      importLegacyPlaylists,
      importDroppedPaths,
    }),
    [
      ready,
      api,
      error,
      clearError,
      folders,
      stats,
      recent,
      recentTotal,
      likes,
      playlists,
      drop,
      clearDrop,
      scan,
      revision,
      loadTracks,
      loadAlbums,
      loadArtists,
      loadGenres,
      loadMix,
      search,
      resolveTrack,
      getTrack,
      hydrateTracks,
      refresh,
      addFolder,
      removeFolder,
      rescan,
      cancelScan,
      toggleLike,
      reportDuration,
      createPlaylist,
      renamePlaylist,
      deletePlaylist,
      addTrackToPlaylist,
      removeFromPlaylist,
      reorderPlaylist,
      importLegacyPlaylists,
      importDroppedPaths,
    ]
  );
}

async function refreshSilently(
  client: LibraryApi,
  setStats: (stats: LibraryStats) => void
): Promise<void> {
  try {
    setStats(await client.getStats());
  } catch {
    // ignore
  }
}
