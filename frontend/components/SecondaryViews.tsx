'use client';

import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import {
  AlertTriangle,
  Clock3,
  Disc3,
  FolderOpen,
  FolderPlus,
  HardDrive,
  Heart,
  ListMusic,
  Loader2,
  Music2,
  Play,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  formatBytes,
  formatLibraryDuration,
  formatRelativeTime,
} from '@/lib/player-logic';
import { CATALOG_IMAGES } from '@/lib/catalog-images';
import type {
  Album,
  Artist,
  DockSection,
  Genre,
  Playlist,
  SearchResults,
  TopTab,
  Track,
} from '@/lib/types';
import type { LibraryController } from '@/lib/use-library';
import { CoverImage } from './CoverImage';
import { TrackListPanel } from './TrackListPanel';

interface SecondaryViewsProps {
  library: LibraryController;
  dockSection: DockSection;
  topTab: TopTab;
  currentTrackId: number | null;
  isPlaying: boolean;
  likedIds: Set<number>;
  playlists: Playlist[];
  queueIds: number[];
  searchQuery: string;
  searchResults: SearchResults;
  searchLoading: boolean;
  volume: number;
  onSearchChange: (q: string) => void;
  onPlayTrack: (track: Track, customQueue?: Track[]) => void;
  onToggleLike: (trackId: number) => void;
  onAddToQueue: (track: Track) => void;
  onAddToPlaylist: (playlistId: string, trackId: number) => void;
  onRemoveFromPlaylist: (playlistId: string, trackId: number) => void;
  onCreatePlaylist: (name: string, description: string) => void;
  onRemoveFromQueue: (trackId: number) => void;
  onVolumeChange: (vol: number) => void;
  onNavigate: (section: DockSection, tab?: TopTab) => void;
  onGoDiscover: () => void;
}

export function SecondaryViews({
  library,
  dockSection,
  topTab,
  currentTrackId,
  isPlaying,
  likedIds,
  playlists,
  queueIds,
  searchQuery,
  searchResults,
  searchLoading,
  volume,
  onSearchChange,
  onPlayTrack,
  onToggleLike,
  onAddToQueue,
  onAddToPlaylist,
  onRemoveFromPlaylist,
  onCreatePlaylist,
  onRemoveFromQueue,
  onVolumeChange,
  onNavigate,
  onGoDiscover,
}: SecondaryViewsProps) {
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [creatingPlaylist, setCreatingPlaylist] = useState(false);

  const [selectedAlbum, setSelectedAlbum] = useState<Album | null>(null);
  const [selectedArtist, setSelectedArtist] = useState<Artist | null>(null);
  const [selectedGenre, setSelectedGenre] = useState<string>('All');

  const [albums, setAlbums] = useState<Album[] | null>(null);
  const [artists, setArtists] = useState<Artist[] | null>(null);
  const [genres, setGenres] = useState<Genre[] | null>(null);
  const [collection, setCollection] = useState<{ key: string; tracks: Track[] } | null>(null);
  const [likedTracks, setLikedTracks] = useState<Track[] | null>(null);

  const {
    revision,
    likes,
    loadAlbums,
    loadArtists,
    loadGenres,
    loadTracks,
    hydrateTracks,
    resolveTrack,
  } = library;

  const activePlaylist =
    playlists.find((playlist) => playlist.id === selectedPlaylistId) ?? playlists[0] ?? null;
  // Prefer the freshly grouped row once it loads (search results carry partial
  // counts), and fall back to the clicked row while the list is in flight.
  const activeAlbum = selectedAlbum
    ? (albums?.find((album) => album.id === selectedAlbum.id) ?? selectedAlbum)
    : (albums?.[0] ?? null);
  const activeArtist = selectedArtist
    ? (artists?.find((artist) => artist.name === selectedArtist.name) ?? selectedArtist)
    : (artists?.[0] ?? null);
  const activeGenre =
    selectedGenre === 'All' || (genres ?? []).some((genre) => genre.name === selectedGenre)
      ? selectedGenre
      : 'All';

  // Collection queries are keyed by the active group so a slow response for a
  // previous album or artist can never replace the current selection.
  const collectionKey =
    topTab === 'Albums' && activeAlbum
      ? `album:${activeAlbum.id}`
      : topTab === 'Artists' && activeArtist
        ? `artist:${activeArtist.name}`
        : topTab === 'Genres'
          ? `genre:${activeGenre}`
          : '';
  const collectionTracks = collection && collection.key === collectionKey ? collection.tracks : [];
  const collectionLoading = collectionKey !== '' && collection?.key !== collectionKey;

  // Queue and playlist entries resolve through the shared track index. The
  // index updates trigger a render, so this stays derived instead of copied.
  const queueTracks = queueIds
    .map((id) => resolveTrack(id))
    .filter((track): track is Track => Boolean(track));
  const playlistTracks = (activePlaylist?.trackIds ?? [])
    .map((id) => resolveTrack(id))
    .filter((track): track is Track => Boolean(track));

  // Albums and artists are grouped in SQLite. Load a generous page once per
  // revision, then fetch only the tracks for the selected group.
  useEffect(() => {
    if (dockSection !== 'home' || topTab !== 'Albums') return;
    let cancelled = false;
    void loadAlbums(300, 0)
      .then((page) => {
        if (!cancelled) setAlbums(page.albums);
      })
      .catch(() => {
        if (!cancelled) setAlbums([]);
      });
    return () => {
      cancelled = true;
    };
  }, [dockSection, topTab, revision, loadAlbums]);

  useEffect(() => {
    if (dockSection !== 'home' || topTab !== 'Artists') return;
    let cancelled = false;
    void loadArtists(300, 0)
      .then((page) => {
        if (!cancelled) setArtists(page.artists);
      })
      .catch(() => {
        if (!cancelled) setArtists([]);
      });
    return () => {
      cancelled = true;
    };
  }, [dockSection, topTab, revision, loadArtists]);

  useEffect(() => {
    if (dockSection !== 'home' || topTab !== 'Genres') return;
    let cancelled = false;
    void loadGenres()
      .then((list) => {
        if (!cancelled) setGenres(list);
      })
      .catch(() => {
        if (!cancelled) setGenres([]);
      });
    return () => {
      cancelled = true;
    };
  }, [dockSection, topTab, revision, loadGenres]);

  useEffect(() => {
    if (dockSection !== 'home' || topTab !== 'Albums' || !activeAlbum) return;
    let cancelled = false;
    const key = `album:${activeAlbum.id}`;
    void loadTracks({
      album: activeAlbum.album,
      albumArtist: activeAlbum.albumArtist,
      sort: 'album_order',
      limit: 1000,
    })
      .then((page) => {
        if (!cancelled) setCollection({ key, tracks: page.tracks });
      })
      .catch(() => {
        if (!cancelled) setCollection({ key, tracks: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [dockSection, topTab, activeAlbum, revision, loadTracks]);

  useEffect(() => {
    if (dockSection !== 'home' || topTab !== 'Artists' || !activeArtist) return;
    let cancelled = false;
    const key = `artist:${activeArtist.name}`;
    void loadTracks({
      artist: activeArtist.name,
      sort: 'album',
      limit: 1000,
    })
      .then((page) => {
        if (!cancelled) setCollection({ key, tracks: page.tracks });
      })
      .catch(() => {
        if (!cancelled) setCollection({ key, tracks: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [dockSection, topTab, activeArtist, revision, loadTracks]);

  useEffect(() => {
    if (dockSection !== 'home' || topTab !== 'Genres') return;
    let cancelled = false;
    const key = `genre:${activeGenre}`;
    void loadTracks({
      genre: activeGenre === 'All' ? '' : activeGenre,
      sort: 'artist',
      limit: 1000,
    })
      .then((page) => {
        if (!cancelled) setCollection({ key, tracks: page.tracks });
      })
      .catch(() => {
        if (!cancelled) setCollection({ key, tracks: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [dockSection, topTab, activeGenre, revision, loadTracks]);

  useEffect(() => {
    if (dockSection !== 'likes') return;
    let cancelled = false;
    void loadTracks({ likedOnly: true, sort: 'title', limit: 1000 })
      .then((page) => {
        if (!cancelled) setLikedTracks(page.tracks);
      })
      .catch(() => {
        if (!cancelled) setLikedTracks([]);
      });
    return () => {
      cancelled = true;
    };
  }, [dockSection, loadTracks, likes, revision]);

  // Resolve queue and playlist IDs through the shared track index. The index
  // update re-renders this component, so the resolved lists stay derived.
  useEffect(() => {
    if (queueIds.length === 0) return;
    void hydrateTracks(queueIds);
  }, [queueIds, hydrateTracks]);

  useEffect(() => {
    if (!activePlaylist || activePlaylist.trackIds.length === 0) return;
    void hydrateTracks(activePlaylist.trackIds);
  }, [activePlaylist, hydrateTracks]);

  // 1. SEARCH VIEW
  if (dockSection === 'search') {
    const query = searchQuery.trim();
    const songs = query ? searchResults.tracks : library.recent;
    const searchAlbums = query ? searchResults.albums : [];
    const searchArtists = query ? searchResults.artists : [];

    return (
      <div className="flex flex-col gap-4 h-full">
        <div className="rounded-[22px] bg-white/[0.06] border border-white/[0.12] px-4 py-3 flex items-center gap-3">
          <Search className="w-4 h-4 text-white/60 shrink-0" />
          <label htmlFor="waven-global-search" className="sr-only">
            Search songs, artists, or albums
          </label>
          <input
            id="waven-global-search"
            type="search"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search your library..."
            className="w-full bg-transparent text-sm text-white placeholder:text-white/45 focus:outline-none"
          />
          {searchLoading && <Loader2 className="w-4 h-4 text-white/60 animate-spin shrink-0" />}
        </div>

        <div className="flex items-center justify-between px-1">
          <h2 className="font-display text-sm font-semibold text-white/90">
            {query ? `Results for "${searchQuery}"` : 'Recently added'}
          </h2>
          <span className="text-xs text-white/50 font-mono-tabular">
            {songs.length} {songs.length === 1 ? 'track' : 'tracks'}
          </span>
        </div>

        {searchAlbums.length > 0 && (
          <div className="space-y-2">
            <h3 className="px-1 text-[11px] font-medium uppercase tracking-wider text-white/45">
              Albums
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {searchAlbums.slice(0, 6).map((album) => (
                <button
                  key={album.id}
                  type="button"
                  onClick={() => {
                    setSelectedAlbum(album);
                    onNavigate('home', 'Albums');
                  }}
                  className="flex items-center gap-3 p-2.5 rounded-2xl border bg-white/[0.045] border-white/[0.08] hover:bg-white/[0.08] text-left transition-colors"
                >
                  <CoverImage
                    src={album.coverSrc}
                    alt={album.album}
                    className="w-10 h-10 rounded-xl object-cover shrink-0"
                  />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-white truncate">{album.album}</p>
                    <p className="text-[11px] text-white/55 truncate">{album.albumArtist}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {searchArtists.length > 0 && (
          <div className="space-y-2">
            <h3 className="px-1 text-[11px] font-medium uppercase tracking-wider text-white/45">
              Artists
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {searchArtists.slice(0, 6).map((artist) => (
                <button
                  key={artist.name}
                  type="button"
                  onClick={() => {
                    setSelectedArtist(artist);
                    onNavigate('home', 'Artists');
                  }}
                  className="flex items-center gap-3 p-2.5 rounded-2xl border bg-white/[0.045] border-white/[0.08] hover:bg-white/[0.08] text-left transition-colors"
                >
                  <CoverImage
                    src={artist.coverSrc}
                    alt={artist.name}
                    className="w-10 h-10 rounded-full object-cover shrink-0"
                  />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-white truncate">{artist.name}</p>
                    <p className="text-[11px] text-white/55">
                      {artist.trackCount} {artist.trackCount === 1 ? 'track' : 'tracks'}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        <TrackListPanel
          tracks={songs}
          currentTrackId={currentTrackId}
          isPlaying={isPlaying}
          likedIds={likedIds}
          playlists={playlists}
          onPlayTrack={(track) => onPlayTrack(track, songs)}
          onToggleLike={onToggleLike}
          onAddToQueue={onAddToQueue}
          onAddToPlaylist={onAddToPlaylist}
          emptyMessage={
            query
              ? 'No matching songs found. Try another artist, album, or title.'
              : 'Your library is empty. Add a music folder in the Library tab.'
          }
        />
      </div>
    );
  }

  // 2. LIBRARY & FOLDER MANAGEMENT
  if (dockSection === 'library') {
    const progress = library.scan.progress;
    const progressPct =
      progress.total > 0 ? Math.min(100, (progress.done / progress.total) * 100) : 0;
    const last = library.scan.last;

    return (
      <div className="flex flex-col gap-4 h-full">
        <div className="rounded-[24px] bg-white/[0.05] border border-white/[0.11] p-4 space-y-3.5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-display text-base font-semibold text-white">
                Your Music Library
              </h2>
              <p className="text-xs text-white/55 mt-0.5">
                {library.stats.tracks.toLocaleString()} tracks · {library.stats.folders}{' '}
                {library.stats.folders === 1 ? 'folder' : 'folders'} · Last scan{' '}
                {formatRelativeTime(library.stats.lastScanAt)}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                disabled={library.scan.running}
                onClick={() => void library.rescan(0)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-40 disabled:hover:bg-white/10 border border-white/15 text-xs font-medium text-white transition-colors whitespace-nowrap"
              >
                <RefreshCw
                  className={cn('w-3.5 h-3.5', library.scan.running && 'animate-spin')}
                />
                <span>Rescan all</span>
              </button>
              <button
                type="button"
                disabled={library.scan.running}
                onClick={() => void library.addFolder()}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-white text-[#0a0c12] hover:bg-white/90 disabled:opacity-40 text-xs font-semibold transition-colors whitespace-nowrap"
              >
                <FolderPlus className="w-3.5 h-3.5" />
                <span>Add folder</span>
              </button>
            </div>
          </div>

          {library.scan.running && (
            <div className="rounded-2xl bg-white/[0.05] border border-white/10 px-3.5 py-3">
              <div className="flex items-center justify-between gap-3">
                <p className="flex items-center gap-2 text-xs text-white/85 min-w-0">
                  <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                  <span className="truncate">
                    {progress.phase === 'discovering'
                      ? 'Finding audio files'
                      : `Scanning ${progress.folderPath || 'library'}`}
                  </span>
                </p>
                <span className="font-mono-tabular text-[11px] text-white/60 shrink-0">
                  {progress.total > 0 ? `${progress.done} / ${progress.total}` : 'Preparing'}
                </span>
                <button
                  type="button"
                  onClick={() => void library.cancelScan()}
                  className="px-3 py-1 rounded-full bg-white/10 hover:bg-white/20 border border-white/15 text-[11px] text-white shrink-0"
                >
                  Cancel
                </button>
              </div>
              <div className="mt-2.5 h-1 rounded-full bg-white/15 overflow-hidden">
                <div
                  className="h-full bg-white/80 rounded-full transition-[width] duration-300"
                  style={{ width: progress.total > 0 ? `${progressPct}%` : '12%' }}
                />
              </div>
              {progress.currentPath && (
                <p className="mt-1.5 text-[10px] text-white/40 truncate">{progress.currentPath}</p>
              )}
            </div>
          )}

          {last && !library.scan.running && (
            <p className="text-[11px] text-white/50">
              {last.canceled ? 'Cancelled' : 'Last scan'} — {last.added} added, {last.updated}{' '}
              updated, {last.skipped} unchanged
              {last.missing > 0 ? `, ${last.missing} missing` : ''}
              {last.errors.length > 0 ? `, ${last.errors.length} skipped` : ''}
            </p>
          )}

          <div className="space-y-1.5">
            {library.folders.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/15 px-4 py-6 text-center">
                <FolderOpen className="w-6 h-6 text-white/40 mx-auto mb-2" />
                <p className="text-xs text-white/60">
                  No music folders yet. Add one and WAVEN will scan it in place.
                </p>
              </div>
            ) : (
              library.folders.map((folder) => (
                <div
                  key={folder.id}
                  className="flex items-center gap-3 rounded-2xl bg-white/[0.04] border border-white/[0.07] px-3 py-2.5"
                >
                  <FolderOpen className="w-4 h-4 text-white/55 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-white/85 truncate" title={folder.path}>
                      {folder.path}
                    </p>
                    <p className="text-[10px] text-white/40">
                      Scanned {formatRelativeTime(folder.lastScanAt ?? 0)}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={library.scan.running}
                    onClick={() => void library.rescan(folder.id)}
                    aria-label={`Rescan ${folder.path}`}
                    title="Rescan folder"
                    className="w-8 h-8 rounded-full text-white/55 hover:text-white hover:bg-white/10 disabled:opacity-30 flex items-center justify-center"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={library.scan.running}
                    onClick={() => {
                      if (
                        window.confirm(
                          `Remove "${folder.path}" and its tracks from WAVEN? The files on disk are not deleted.`
                        )
                      ) {
                        void library.removeFolder(folder.id);
                      }
                    }}
                    aria-label={`Remove ${folder.path}`}
                    title="Remove folder from library"
                    className="w-8 h-8 rounded-full text-white/55 hover:text-rose-200 hover:bg-rose-500/10 disabled:opacity-30 flex items-center justify-center"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>

          {library.preview && (
            <p className="text-[10px] text-amber-100/60">
              Browser preview: folder scanning runs against sample data. Open the desktop app to
              scan real files.
            </p>
          )}
        </div>

        {/* Play Queue */}
        <div className="flex items-center justify-between px-1">
          <h3 className="font-display text-sm font-semibold text-white/90 flex items-center gap-2">
            <ListMusic className="w-4 h-4 text-white/70" />
            <span>Up Next Queue</span>
          </h3>
          <span className="text-xs text-white/50 font-mono-tabular">
            {queueTracks.length} queued
          </span>
        </div>

        <div className="rounded-[24px] bg-white/[0.045] border border-white/[0.1] p-2.5 flex-1 overflow-y-auto max-h-[265px] waven-scroll space-y-1">
          {queueTracks.length === 0 ? (
            <p className="px-3 py-8 text-center text-xs text-white/50">
              Nothing queued yet. Play a song or use a track menu to add one.
            </p>
          ) : (
            queueTracks.map((track, idx) => (
              <div
                key={`${track.id}-${idx}`}
                className={cn(
                  'flex items-center justify-between gap-3 px-2.5 py-2 rounded-2xl',
                  track.id === currentTrackId ? 'bg-white/[0.1]' : 'hover:bg-white/[0.05]'
                )}
              >
                <button
                  type="button"
                  onClick={() => onPlayTrack(track, queueTracks)}
                  className="flex items-center gap-3 min-w-0 flex-1 text-left"
                >
                  <span className="font-mono-tabular text-[11px] text-white/45 w-5">
                    {String(idx + 1).padStart(2, '0')}
                  </span>
                  <CoverImage
                    src={track.coverSrc}
                    alt={track.title}
                    className="w-9 h-9 rounded-full object-cover shrink-0"
                  />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-white truncate">{track.title}</p>
                    <p className="text-[11px] text-white/55 truncate">{track.artist}</p>
                  </div>
                </button>
                {queueTracks.length > 1 && (
                  <button
                    type="button"
                    aria-label={`Remove ${track.title} from queue`}
                    onClick={() => onRemoveFromQueue(track.id)}
                    className="w-8 h-8 rounded-full text-white/45 hover:text-white hover:bg-white/10 flex items-center justify-center"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    );
  }

  // 3. LIKES VIEW
  if (dockSection === 'likes') {
    const liked = likedTracks ?? [];
    const likedLoading = likedTracks === null;
    return (
      <div className="flex flex-col gap-4 h-full">
        <div className="rounded-[24px] bg-white/[0.05] border border-white/[0.11] p-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-white/15 border border-white/20 flex items-center justify-center">
              <Heart className="w-5 h-5 text-white fill-white" />
            </div>
            <div>
              <h2 className="font-display text-base font-semibold text-white">Liked Songs</h2>
              <p className="text-xs text-white/55">
                {library.stats.liked} {library.stats.liked === 1 ? 'track' : 'tracks'} saved
              </p>
            </div>
          </div>
          {liked.length > 0 && (
            <button
              type="button"
              onClick={() => onPlayTrack(liked[0], liked)}
              className="px-4 py-2 rounded-full bg-white text-[#090b10] text-xs font-semibold flex items-center gap-1.5 hover:bg-white/90 whitespace-nowrap"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Play All</span>
            </button>
          )}
        </div>

        <TrackListPanel
          tracks={liked}
          currentTrackId={currentTrackId}
          isPlaying={isPlaying}
          likedIds={likedIds}
          playlists={playlists}
          onPlayTrack={(track) => onPlayTrack(track, liked)}
          onToggleLike={onToggleLike}
          onAddToQueue={onAddToQueue}
          onAddToPlaylist={onAddToPlaylist}
          emptyMessage={
            likedLoading
              ? 'Loading liked songs…'
              : 'Tap the heart icon on any track to collect your favorites here.'
          }
        />
      </div>
    );
  }

  // 4. PROFILE VIEW
  if (dockSection === 'profile') {
    const stats = library.stats;
    const summary: Array<{ label: string; value: string; icon: typeof Music2 }> = [
      { label: 'Tracks', value: stats.tracks.toLocaleString(), icon: Music2 },
      { label: 'Albums', value: stats.albums.toLocaleString(), icon: Disc3 },
      { label: 'Artists', value: stats.artists.toLocaleString(), icon: Heart },
      { label: 'Genres', value: stats.genres.toLocaleString(), icon: Music2 },
      { label: 'Folders', value: stats.folders.toLocaleString(), icon: FolderOpen },
      { label: 'Liked', value: stats.liked.toLocaleString(), icon: Heart },
      { label: 'Listening time', value: formatLibraryDuration(stats.durationMs), icon: Clock3 },
      { label: 'Artwork cache', value: formatBytes(stats.cacheBytes), icon: HardDrive },
    ];

    return (
      <div className="flex flex-col gap-4 h-full">
        <div className="rounded-[26px] bg-white/[0.05] border border-white/[0.11] p-5 flex items-center gap-4">
          <CoverImage
            src={CATALOG_IMAGES.avatar}
            alt="Listener avatar"
            className="w-16 h-16 rounded-full object-cover ring-2 ring-white/25"
          />
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-lg font-bold text-white">Studio Listener</h2>
            <p className="text-xs text-white/60 mt-0.5">
              {stats.tracks.toLocaleString()} Tracks · {stats.liked.toLocaleString()} Liked ·{' '}
              {playlists.length} {playlists.length === 1 ? 'Playlist' : 'Playlists'}
            </p>
            <p className="text-[10px] text-white/40 mt-1">
              Local library · Last scan {formatRelativeTime(stats.lastScanAt)}
              {library.preview ? ' · Browser preview' : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onGoDiscover}
            className="px-4 py-2 rounded-full bg-white/12 hover:bg-white/20 border border-white/15 text-xs font-medium text-white whitespace-nowrap"
          >
            Back to Discover
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {summary.map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.label}
                className="rounded-2xl bg-white/[0.045] border border-white/[0.08] px-3 py-2.5"
              >
                <Icon className="w-3.5 h-3.5 text-white/40 mb-1.5" />
                <p className="font-display text-sm font-semibold text-white">{item.value}</p>
                <p className="text-[10px] text-white/45">{item.label}</p>
              </div>
            );
          })}
        </div>

        {stats.missing > 0 && (
          <div className="flex items-start gap-2.5 rounded-2xl border border-amber-300/25 bg-amber-400/10 px-4 py-3 text-xs text-amber-100/85">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <p>
              {stats.missing} {stats.missing === 1 ? 'track is' : 'tracks are'} missing on disk.
              Rescan the library to refresh the index, or remove the affected folder.
            </p>
          </div>
        )}

        <div className="rounded-[24px] bg-white/[0.045] border border-white/[0.1] p-5 space-y-4 flex-1">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-white/80">
              <span className="font-medium">Master Output Volume</span>
              <span className="font-mono-tabular text-white/60">{Math.round(volume * 100)}%</span>
            </div>
            <input
              type="range"
              aria-label="Master output volume"
              min={0}
              max={1}
              step={0.01}
              value={volume}
              onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
              className="w-full accent-white h-1.5 bg-white/20 rounded-full cursor-pointer"
            />
          </div>

          <div className="border-t border-white/10 pt-4 space-y-2.5">
            <h3 className="text-xs font-semibold text-white/85">Keyboard Shortcuts</h3>
            <div className="grid grid-cols-2 gap-2 text-xs text-white/65">
              <div className="flex items-center justify-between rounded-xl bg-white/[0.04] px-3 py-2">
                <span>Play / Pause</span>
                <kbd className="font-mono-tabular text-white/90">Space</kbd>
              </div>
              <div className="flex items-center justify-between rounded-xl bg-white/[0.04] px-3 py-2">
                <span>Seek 5s</span>
                <kbd className="font-mono-tabular text-white/90">← / →</kbd>
              </div>
              <div className="flex items-center justify-between rounded-xl bg-white/[0.04] px-3 py-2">
                <span>Next / Prev</span>
                <kbd className="font-mono-tabular text-white/90">N / P</kbd>
              </div>
              <div className="flex items-center justify-between rounded-xl bg-white/[0.04] px-3 py-2">
                <span>Like Track</span>
                <kbd className="font-mono-tabular text-white/90">L</kbd>
              </div>
              <div className="flex items-center justify-between rounded-xl bg-white/[0.04] px-3 py-2">
                <span>Search</span>
                <kbd className="font-mono-tabular text-white/90">⌘ / Ctrl F</kbd>
              </div>
              <div className="flex items-center justify-between rounded-xl bg-white/[0.04] px-3 py-2">
                <span>Back Home</span>
                <kbd className="font-mono-tabular text-white/90">Esc</kbd>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 5. PLAYLISTS TAB
  if (topTab === 'Playlists') {
    const handleCreate = (e: FormEvent) => {
      e.preventDefault();
      if (!newPlaylistName.trim()) return;
      onCreatePlaylist(newPlaylistName.trim(), 'Custom collection');
      setNewPlaylistName('');
      setCreatingPlaylist(false);
    };

    return (
      <div className="flex flex-col gap-4 h-full">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 overflow-x-auto waven-scroll pb-1">
            {playlists.length === 0 ? (
              <span className="text-xs text-white/50">No playlists yet</span>
            ) : (
              playlists.map((pl) => (
                <button
                  key={pl.id}
                  type="button"
                  onClick={() => setSelectedPlaylistId(pl.id)}
                  className={cn(
                    'px-3.5 py-2 rounded-full text-xs font-medium border transition-colors whitespace-nowrap shrink-0',
                    activePlaylist?.id === pl.id
                      ? 'bg-white text-[#090b10] border-white'
                      : 'bg-white/[0.06] text-white/80 border-white/10 hover:bg-white/[0.12]'
                  )}
                >
                  {pl.name} ({pl.trackIds.length})
                </button>
              ))
            )}
          </div>

          <button
            type="button"
            onClick={() => setCreatingPlaylist(!creatingPlaylist)}
            className="px-3.5 py-2 rounded-full bg-white/[0.1] hover:bg-white/[0.18] border border-white/15 text-xs font-medium text-white flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Playlist</span>
          </button>
        </div>

        {creatingPlaylist && (
          <form
            onSubmit={handleCreate}
            className="rounded-2xl bg-white/[0.06] border border-white/15 p-3 flex items-center gap-2"
          >
            <input
              type="text"
              aria-label="Playlist name"
              placeholder="Playlist name (e.g. Evening Drive)"
              value={newPlaylistName}
              onChange={(e) => setNewPlaylistName(e.target.value)}
              className="flex-1 bg-transparent text-xs text-white placeholder:text-white/45 focus:outline-none px-2"
            />
            <button
              type="submit"
              className="px-3.5 py-1.5 rounded-full bg-white text-[#0a0c12] text-xs font-semibold whitespace-nowrap"
            >
              Create
            </button>
          </form>
        )}

        {activePlaylist && (
          <div className="rounded-[22px] bg-white/[0.05] border border-white/[0.1] p-3.5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <CoverImage
                src={playlistTracks[0]?.coverSrc || activePlaylist.coverSrc}
                alt={activePlaylist.name}
                className="w-12 h-12 rounded-2xl object-cover shrink-0"
              />
              <div className="min-w-0">
                <h2 className="font-display text-base font-semibold text-white truncate">
                  {activePlaylist.name}
                </h2>
                <p className="text-xs text-white/55 truncate">
                  {playlistTracks.length} songs · {activePlaylist.description}
                </p>
              </div>
            </div>
            {playlistTracks.length > 0 && (
              <button
                type="button"
                onClick={() => onPlayTrack(playlistTracks[0], playlistTracks)}
                className="px-4 py-2 rounded-full bg-white text-[#090b10] text-xs font-semibold flex items-center gap-1.5 shrink-0"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Play</span>
              </button>
            )}
          </div>
        )}

        <TrackListPanel
          tracks={playlistTracks}
          currentTrackId={currentTrackId}
          isPlaying={isPlaying}
          likedIds={likedIds}
          playlists={playlists}
          onPlayTrack={(track) => onPlayTrack(track, playlistTracks)}
          onToggleLike={onToggleLike}
          onAddToQueue={onAddToQueue}
          onAddToPlaylist={(playlistId, trackId) => {
            if (playlistId === activePlaylist?.id) {
              onRemoveFromPlaylist(playlistId, trackId);
            } else {
              onAddToPlaylist(playlistId, trackId);
            }
          }}
          emptyMessage={
            activePlaylist
              ? 'This playlist is empty. Use the ··· menu on any track to add songs.'
              : 'Create a playlist to start collecting tracks.'
          }
        />
      </div>
    );
  }

  // 6. ARTISTS TAB
  if (topTab === 'Artists') {
    const artistList = artists ?? [];
    const artistsLoading = artists === null;
    return (
      <div className="flex flex-col gap-4 h-full">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 max-h-[210px] overflow-y-auto waven-scroll pr-0.5">
          {artistList.length === 0 ? (
            <p className="col-span-full text-xs text-white/50 px-1 py-4">
              {artistsLoading ? 'Loading artists…' : 'No artists in your library yet.'}
            </p>
          ) : (
            artistList.map((artist) => (
              <button
                key={artist.name}
                type="button"
                onClick={() => setSelectedArtist(artist)}
                className={cn(
                  'flex items-center gap-3 p-2.5 rounded-2xl border text-left transition-colors',
                  activeArtist?.name === artist.name
                    ? 'bg-white/[0.12] border-white/30'
                    : 'bg-white/[0.045] border-white/[0.08] hover:bg-white/[0.08]'
                )}
              >
                <CoverImage
                  src={artist.coverSrc}
                  alt={artist.name}
                  className="w-10 h-10 rounded-full object-cover shrink-0"
                />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-white truncate">{artist.name}</p>
                  <p className="text-[11px] text-white/55">
                    {artist.trackCount} {artist.trackCount === 1 ? 'track' : 'tracks'} ·{' '}
                    {artist.albumCount} {artist.albumCount === 1 ? 'album' : 'albums'}
                  </p>
                </div>
              </button>
            ))
          )}
        </div>

        {activeArtist && (
          <div className="rounded-[22px] bg-white/[0.05] border border-white/[0.1] p-3.5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <CoverImage
                src={activeArtist.coverSrc}
                alt={activeArtist.name}
                className="w-12 h-12 rounded-full object-cover shrink-0"
              />
              <div className="min-w-0">
                <h2 className="font-display text-base font-semibold text-white truncate">
                  {activeArtist.name}
                </h2>
                <p className="text-xs text-white/55">
                  {activeArtist.trackCount} {activeArtist.trackCount === 1 ? 'track' : 'tracks'}
                </p>
              </div>
            </div>
            {collectionTracks.length > 0 && (
              <button
                type="button"
                onClick={() => onPlayTrack(collectionTracks[0], collectionTracks)}
                className="px-4 py-2 rounded-full bg-white text-[#090b10] text-xs font-semibold flex items-center gap-1.5 shrink-0"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Play</span>
              </button>
            )}
          </div>
        )}

        <TrackListPanel
          tracks={collectionTracks}
          currentTrackId={currentTrackId}
          isPlaying={isPlaying}
          likedIds={likedIds}
          playlists={playlists}
          onPlayTrack={(track) => onPlayTrack(track, collectionTracks)}
          onToggleLike={onToggleLike}
          onAddToQueue={onAddToQueue}
          onAddToPlaylist={onAddToPlaylist}
          emptyMessage={collectionLoading ? 'Loading tracks…' : 'No tracks for this artist.'}
        />
      </div>
    );
  }

  // 7. ALBUMS TAB
  if (topTab === 'Albums') {
    const albumList = albums ?? [];
    const albumsLoading = albums === null;
    return (
      <div className="flex flex-col gap-4 h-full">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 max-h-[210px] overflow-y-auto waven-scroll pr-0.5">
          {albumList.length === 0 ? (
            <p className="col-span-full text-xs text-white/50 px-1 py-4">
              {albumsLoading ? 'Loading albums…' : 'No albums in your library yet.'}
            </p>
          ) : (
            albumList.map((album) => (
              <button
                key={album.id}
                type="button"
                onClick={() => setSelectedAlbum(album)}
                className={cn(
                  'flex items-center gap-3 p-2.5 rounded-2xl border text-left transition-colors',
                  activeAlbum?.id === album.id
                    ? 'bg-white/[0.12] border-white/30'
                    : 'bg-white/[0.045] border-white/[0.08] hover:bg-white/[0.08]'
                )}
              >
                <CoverImage
                  src={album.coverSrc}
                  alt={album.album}
                  className="w-10 h-10 rounded-xl object-cover shrink-0"
                />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-white truncate">{album.album}</p>
                  <p className="text-[11px] text-white/55 truncate">
                    {album.albumArtist || 'Unknown artist'}
                    {album.year > 0 ? ` · ${album.year}` : ''}
                  </p>
                </div>
              </button>
            ))
          )}
        </div>

        {activeAlbum && (
          <div className="rounded-[22px] bg-white/[0.05] border border-white/[0.1] p-3.5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <CoverImage
                src={activeAlbum.coverSrc}
                alt={activeAlbum.album}
                className="w-12 h-12 rounded-xl object-cover shrink-0"
              />
              <div className="min-w-0">
                <h2 className="font-display text-base font-semibold text-white truncate">
                  {activeAlbum.album}
                </h2>
                <p className="text-xs text-white/55 truncate">
                  {activeAlbum.albumArtist || 'Unknown artist'} · {activeAlbum.trackCount}{' '}
                  {activeAlbum.trackCount === 1 ? 'track' : 'tracks'}
                </p>
              </div>
            </div>
            {collectionTracks.length > 0 && (
              <button
                type="button"
                onClick={() => onPlayTrack(collectionTracks[0], collectionTracks)}
                className="px-4 py-2 rounded-full bg-white text-[#090b10] text-xs font-semibold flex items-center gap-1.5 shrink-0"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Play</span>
              </button>
            )}
          </div>
        )}

        <TrackListPanel
          tracks={collectionTracks}
          currentTrackId={currentTrackId}
          isPlaying={isPlaying}
          likedIds={likedIds}
          playlists={playlists}
          onPlayTrack={(track) => onPlayTrack(track, collectionTracks)}
          onToggleLike={onToggleLike}
          onAddToQueue={onAddToQueue}
          onAddToPlaylist={onAddToPlaylist}
          emptyMessage={collectionLoading ? 'Loading tracks…' : 'No tracks for this album.'}
        />
      </div>
    );
  }

  // 8. GENRES TAB
  const genreList = genres ?? [];
  const genreOptions = ['All', ...genreList.map((genre) => genre.name)];
  const genresLoading = genres === null;

  return (
    <div className="flex flex-col gap-4 h-full">
      <div className="flex items-center gap-2 overflow-x-auto waven-scroll pb-1">
        {genreOptions.length === 1 && genresLoading ? (
          <span className="text-xs text-white/50 px-1">Loading genres…</span>
        ) : (
          genreOptions.map((genre) => (
            <button
              key={genre}
              type="button"
              onClick={() => setSelectedGenre(genre)}
              className={cn(
                'px-3.5 py-2 rounded-full text-xs font-medium border transition-colors whitespace-nowrap shrink-0',
                activeGenre === genre
                  ? 'bg-white text-[#090b10] border-white'
                  : 'bg-white/[0.06] text-white/80 border-white/10 hover:bg-white/[0.12]'
              )}
            >
              {genre}
              {genre !== 'All' && (
                <span className="ml-1.5 text-[10px] opacity-60">
                  {genreList.find((entry) => entry.name === genre)?.trackCount ?? 0}
                </span>
              )}
            </button>
          ))
        )}
      </div>

      <TrackListPanel
        tracks={collectionTracks}
        currentTrackId={currentTrackId}
        isPlaying={isPlaying}
        likedIds={likedIds}
        playlists={playlists}
        onPlayTrack={(track) => onPlayTrack(track, collectionTracks)}
        onToggleLike={onToggleLike}
        onAddToQueue={onAddToQueue}
        onAddToPlaylist={onAddToPlaylist}
        emptyMessage={
          collectionLoading
            ? 'Loading tracks…'
            : activeGenre === 'All'
              ? 'Your library is empty. Add a music folder in the Library tab.'
              : 'No tracks in this genre.'
        }
      />
    </div>
  );
}
