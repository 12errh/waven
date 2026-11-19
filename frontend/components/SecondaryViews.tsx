'use client';

import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import {
  AlertTriangle,
  Check,
  Clock3,
  Disc3,
  FolderOpen,
  FolderPlus,
  HardDrive,
  Heart,
  ListMusic,
  Loader2,
  Music2,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  X,
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
import type { SettingsController } from '@/lib/use-settings';
import { CoverImage } from './CoverImage';
import { LibraryFoldersPanel } from './LibraryFoldersPanel';
import { SearchView } from './SearchView';
import { SettingsView } from './SettingsView';
import { TrackListPanel } from './TrackListPanel';

interface SecondaryViewsProps {
  library: LibraryController;
  settings: SettingsController;
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
  onAddToPlaylist: (playlistId: number, trackId: number) => void;
  onRemoveFromPlaylist: (playlistId: number, trackId: number) => void;
  onCreatePlaylist: (name: string) => void;
  onRenamePlaylist: (playlistId: number, name: string) => void;
  onDeletePlaylist: (playlistId: number) => void;
  onReorderPlaylist: (playlistId: number, trackIds: number[]) => void;
  onRemoveFromQueue: (trackId: number) => void;
  onVolumeChange: (vol: number) => void;
  onNavigate: (section: DockSection, tab?: TopTab) => void;
  onGoDiscover: () => void;
}

export function SecondaryViews({
  library,
  settings,
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
  onRenamePlaylist,
  onDeletePlaylist,
  onReorderPlaylist,
  onRemoveFromQueue,
  onVolumeChange,
  onNavigate,
  onGoDiscover,
}: SecondaryViewsProps) {
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<number | null>(null);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [creatingPlaylist, setCreatingPlaylist] = useState(false);
  const [renamingPlaylist, setRenamingPlaylist] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);

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
    return (
      <SearchView
        library={library}
        searchQuery={searchQuery}
        searchResults={searchResults}
        searchLoading={searchLoading}
        currentTrackId={currentTrackId}
        isPlaying={isPlaying}
        likedIds={likedIds}
        playlists={playlists}
        onSearchChange={onSearchChange}
        onPlayTrack={onPlayTrack}
        onToggleLike={onToggleLike}
        onAddToQueue={onAddToQueue}
        onAddToPlaylist={onAddToPlaylist}
        onOpenAlbum={(album) => {
          setSelectedAlbum(album);
          onNavigate('home', 'Albums');
        }}
        onOpenArtist={(artist) => {
          setSelectedArtist(artist);
          onNavigate('home', 'Artists');
        }}
      />
    );
  }

  // 2. LIBRARY & FOLDER MANAGEMENT
  if (dockSection === 'library') {
    return (
      <div className="flex flex-col gap-4 h-full">
        <LibraryFoldersPanel library={library} />

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

  // 4. PROFILE & SETTINGS VIEW
  if (dockSection === 'profile') {
    return (
      <SettingsView
        library={library}
        settings={settings}
        playlists={playlists}
        volume={volume}
        onVolumeChange={onVolumeChange}
        onGoDiscover={onGoDiscover}
      />
    );
  }

  // 5. PLAYLISTS TAB
  if (topTab === 'Playlists') {
    const handleCreate = (event: FormEvent) => {
      event.preventDefault();
      const name = newPlaylistName.trim();
      if (!name) return;
      onCreatePlaylist(name);
      setNewPlaylistName('');
      setCreatingPlaylist(false);
    };

    const beginRename = () => {
      if (!activePlaylist) return;
      setRenameValue(activePlaylist.name);
      setRenamingPlaylist(true);
      setConfirmingDelete(false);
    };

    const submitRename = (event: FormEvent) => {
      event.preventDefault();
      if (!activePlaylist) return;
      const name = renameValue.trim();
      if (!name) return;
      onRenamePlaylist(activePlaylist.id, name);
      setRenamingPlaylist(false);
    };

    const moveTrack = (trackId: number, direction: -1 | 1) => {
      if (!activePlaylist) return;
      const ids = [...activePlaylist.trackIds];
      const index = ids.indexOf(trackId);
      const next = index + direction;
      if (index < 0 || next < 0 || next >= ids.length) return;
      [ids[index], ids[next]] = [ids[next], ids[index]];
      onReorderPlaylist(activePlaylist.id, ids);
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
                  onClick={() => {
                    setSelectedPlaylistId(pl.id);
                    setRenamingPlaylist(false);
                    setConfirmingDelete(false);
                  }}
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
              maxLength={80}
              onChange={(e) => setNewPlaylistName(e.target.value)}
              className="flex-1 bg-transparent text-xs text-white placeholder:text-white/45 focus:outline-none px-2"
            />
            <button
              type="submit"
              disabled={!newPlaylistName.trim()}
              className="px-3.5 py-1.5 rounded-full bg-white text-[#0a0c12] text-xs font-semibold whitespace-nowrap disabled:opacity-40"
            >
              Create
            </button>
          </form>
        )}

        {playlists.length === 0 && !creatingPlaylist && (
          <div className="rounded-[24px] bg-white/[0.045] border border-white/[0.1] px-6 py-10 text-center">
            <ListMusic className="mx-auto h-7 w-7 text-white/40" />
            <h2 className="mt-3 font-display text-sm font-semibold text-white">
              Build your first playlist
            </h2>
            <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-white/50">
              Playlists live in your local database. Create one here, then add songs from any
              track menu.
            </p>
          </div>
        )}

        {activePlaylist && (
          <div className="rounded-[22px] bg-white/[0.05] border border-white/[0.1] p-3.5">
            {renamingPlaylist ? (
              <form onSubmit={submitRename} className="flex items-center gap-2">
                <input
                  type="text"
                  aria-label="Rename playlist"
                  value={renameValue}
                  maxLength={80}
                  autoFocus
                  onChange={(e) => setRenameValue(e.target.value)}
                  className="min-w-0 flex-1 rounded-xl border border-white/15 bg-white/[0.06] px-3 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-white/40"
                />
                <button
                  type="submit"
                  aria-label="Save playlist name"
                  disabled={!renameValue.trim()}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-[#090b10] disabled:opacity-40"
                >
                  <Check className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  aria-label="Cancel rename"
                  onClick={() => setRenamingPlaylist(false)}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/15 text-white/70 hover:bg-white/10"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </form>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
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
                      {playlistTracks.length} {playlistTracks.length === 1 ? 'song' : 'songs'} ·
                      Updated {formatRelativeTime(activePlaylist.updatedAt)}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {playlistTracks.length > 0 && (
                    <button
                      type="button"
                      onClick={() => onPlayTrack(playlistTracks[0], playlistTracks)}
                      className="px-4 py-2 rounded-full bg-white text-[#090b10] text-xs font-semibold flex items-center gap-1.5"
                    >
                      <Play className="w-3.5 h-3.5 fill-current" />
                      <span>Play</span>
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label="Rename playlist"
                    onClick={beginRename}
                    className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-white/65 hover:bg-white/10 hover:text-white"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label="Delete playlist"
                    onClick={() => setConfirmingDelete(true)}
                    className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-white/65 hover:bg-rose-500/15 hover:text-rose-200"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )}

            {confirmingDelete && !renamingPlaylist && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-rose-400/25 bg-rose-500/10 px-3 py-2.5 text-xs text-rose-50">
                <span>
                  Delete “{activePlaylist.name}”? Songs stay in your library.
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmingDelete(false)}
                    className="rounded-full border border-white/20 px-3 py-1 text-[11px] text-white/80 hover:bg-white/10"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onDeletePlaylist(activePlaylist.id);
                      setConfirmingDelete(false);
                    }}
                    className="rounded-full bg-rose-200 px-3 py-1 text-[11px] font-semibold text-rose-950 hover:bg-rose-100"
                  >
                    Delete
                  </button>
                </div>
              </div>
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
          onAddToPlaylist={onAddToPlaylist}
          onRemoveTrack={
            activePlaylist
              ? (trackId) => onRemoveFromPlaylist(activePlaylist.id, trackId)
              : undefined
          }
          onMoveTrack={activePlaylist ? moveTrack : undefined}
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
