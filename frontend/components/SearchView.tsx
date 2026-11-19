'use client';

import { useEffect, useMemo, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Loader2, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Album, Artist, Playlist, SearchResults, Track } from '@/lib/types';
import type { LibraryController } from '@/lib/use-library';
import { CoverImage } from './CoverImage';
import { TrackListPanel } from './TrackListPanel';

interface SearchViewProps {
  library: LibraryController;
  searchQuery: string;
  searchResults: SearchResults;
  searchLoading: boolean;
  currentTrackId: number | null;
  isPlaying: boolean;
  likedIds: Set<number>;
  playlists: Playlist[];
  onSearchChange: (query: string) => void;
  onPlayTrack: (track: Track, customQueue?: Track[]) => void;
  onToggleLike: (trackId: number) => void;
  onAddToQueue: (track: Track) => void;
  onAddToPlaylist: (playlistId: number, trackId: number) => void;
  onOpenAlbum: (album: Album) => void;
  onOpenArtist: (artist: Artist) => void;
}

type SearchItem =
  | { kind: 'album'; key: string; album: Album }
  | { kind: 'artist'; key: string; artist: Artist }
  | { kind: 'track'; key: string; track: Track };

/**
 * Grouped local search with a single keyboard cursor across albums, artists,
 * and songs. Focus stays in the input; ArrowUp/ArrowDown move the highlight,
 * Enter opens the highlighted result, and Escape clears the query.
 */
export function SearchView({
  library,
  searchQuery,
  searchResults,
  searchLoading,
  currentTrackId,
  isPlaying,
  likedIds,
  playlists,
  onSearchChange,
  onPlayTrack,
  onToggleLike,
  onAddToQueue,
  onAddToPlaylist,
  onOpenAlbum,
  onOpenArtist,
}: SearchViewProps) {
  // The cursor remembers which query it belongs to so a new query starts with
  // nothing highlighted without a state-resetting effect.
  const [cursor, setCursor] = useState<{ query: string; index: number }>({
    query: '',
    index: -1,
  });

  const query = searchQuery.trim();
  const songs = useMemo(
    () => (query ? searchResults.tracks : library.recent),
    [query, searchResults, library.recent]
  );
  const albums = useMemo(
    () => (query ? searchResults.albums.slice(0, 6) : []),
    [query, searchResults]
  );
  const artists = useMemo(
    () => (query ? searchResults.artists.slice(0, 6) : []),
    [query, searchResults]
  );

  const items = useMemo<SearchItem[]>(() => {
    const next: SearchItem[] = [];
    for (const album of albums) {
      next.push({ kind: 'album', key: `album:${album.id}`, album });
    }
    for (const artist of artists) {
      next.push({ kind: 'artist', key: `artist:${artist.name}`, artist });
    }
    for (const track of songs) {
      next.push({ kind: 'track', key: `track:${track.id}`, track });
    }
    return next;
  }, [albums, artists, songs]);

  const activeIndex =
    cursor.query === query ? Math.min(cursor.index, items.length - 1) : -1;

  function setActiveIndex(next: number | ((current: number) => number)) {
    setCursor((current) => {
      const base = current.query === query ? current.index : -1;
      return { query, index: typeof next === 'function' ? next(base) : next };
    });
  }

  const activeItem = activeIndex >= 0 ? items[activeIndex] : undefined;
  const activeTrackId = activeItem?.kind === 'track' ? activeItem.track.id : null;

  useEffect(() => {
    if (activeIndex < 0) return;
    const element = document.querySelector(`[data-search-index="${activeIndex}"]`);
    element?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  function activate(item: SearchItem | undefined) {
    if (!item) return;
    if (item.kind === 'album') onOpenAlbum(item.album);
    else if (item.kind === 'artist') onOpenArtist(item.artist);
    else onPlayTrack(item.track, songs);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((current) =>
        items.length === 0 ? -1 : Math.min(items.length - 1, current + 1)
      );
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((current) => (items.length === 0 ? -1 : Math.max(0, current - 1)));
      return;
    }
    if (event.key === 'Enter') {
      if (items.length === 0) return;
      event.preventDefault();
      activate(activeItem ?? items[0]);
      return;
    }
    if (event.key === 'Escape' && searchQuery) {
      event.preventDefault();
      onSearchChange('');
      setActiveIndex(-1);
    }
  }

  const activeLabel = !activeItem
    ? ''
    : activeItem.kind === 'album'
      ? `Album ${activeItem.album.album} by ${activeItem.album.albumArtist || 'unknown artist'}`
      : activeItem.kind === 'artist'
        ? `Artist ${activeItem.artist.name}`
        : `Track ${activeItem.track.title} by ${activeItem.track.artist}`;

  const albumOffset = 0;
  const artistOffset = albums.length;
  const trackOffset = albums.length + artists.length;

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
          onKeyDown={handleKeyDown}
          placeholder="Search your library..."
          autoComplete="off"
          aria-controls="waven-search-results"
          aria-describedby={query && items.length > 0 ? 'waven-search-hint' : undefined}
          className="w-full bg-transparent text-sm text-white placeholder:text-white/45 focus:outline-none"
        />
        {searchLoading && <Loader2 className="w-4 h-4 text-white/60 animate-spin shrink-0" />}
      </div>

      <div className="flex items-center justify-between gap-3 px-1">
        <h2 className="font-display text-sm font-semibold text-white/90">
          {query ? `Results for "${searchQuery}"` : 'Recently added'}
        </h2>
        <span className="text-xs text-white/50 font-mono-tabular">
          {songs.length} {songs.length === 1 ? 'track' : 'tracks'}
        </span>
      </div>

      {query && items.length > 0 && (
        <p id="waven-search-hint" className="-mt-2 px-1 text-[10px] text-white/40">
          ↑ ↓ move through results · Enter opens · Esc clears
        </p>
      )}

      <p className="sr-only" aria-live="polite">
        {activeLabel}
      </p>

      <div id="waven-search-results" className="flex flex-col gap-4">
        {albums.length > 0 && (
          <div className="space-y-2" role="group" aria-label="Album results">
            <h3 className="px-1 text-[11px] font-medium uppercase tracking-wider text-white/45">
              Albums
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {albums.map((album, index) => {
                const itemIndex = albumOffset + index;
                const selected = activeIndex === itemIndex;
                return (
                  <button
                    key={album.id}
                    type="button"
                    data-search-index={itemIndex}
                    tabIndex={-1}
                    aria-current={selected ? 'true' : undefined}
                    onMouseEnter={() => setActiveIndex(itemIndex)}
                    onClick={() => activate({ kind: 'album', key: `album:${album.id}`, album })}
                    className={cn(
                      'flex items-center gap-3 p-2.5 rounded-2xl border text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50',
                      selected
                        ? 'bg-white/[0.14] border-white/35'
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
                      <p className="text-[11px] text-white/55 truncate">{album.albumArtist}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {artists.length > 0 && (
          <div className="space-y-2" role="group" aria-label="Artist results">
            <h3 className="px-1 text-[11px] font-medium uppercase tracking-wider text-white/45">
              Artists
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {artists.map((artist, index) => {
                const itemIndex = artistOffset + index;
                const selected = activeIndex === itemIndex;
                return (
                  <button
                    key={artist.name}
                    type="button"
                    data-search-index={itemIndex}
                    tabIndex={-1}
                    aria-current={selected ? 'true' : undefined}
                    onMouseEnter={() => setActiveIndex(itemIndex)}
                    onClick={() => activate({ kind: 'artist', key: `artist:${artist.name}`, artist })}
                    className={cn(
                      'flex items-center gap-3 p-2.5 rounded-2xl border text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50',
                      selected
                        ? 'bg-white/[0.14] border-white/35'
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
                        {artist.trackCount} {artist.trackCount === 1 ? 'track' : 'tracks'}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <TrackListPanel
          tracks={songs}
          currentTrackId={currentTrackId}
          isPlaying={isPlaying}
          likedIds={likedIds}
          playlists={playlists}
          activeTrackId={activeTrackId}
          trackIndexOffset={trackOffset}
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
    </div>
  );
}
