'use client';

import { useState } from 'react';
import {
  Disc3,
  Heart,
  Link2,
  ListMusic,
  Loader2,
  Music2,
  Play,
  Plus,
  Search,
  Trash2,
  Upload,
  User,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  filterTracksByGenre,
  groupTracksByAlbum,
  groupTracksByArtist,
} from '@/lib/player-logic';
import { CATALOG_IMAGES } from '@/lib/catalog-images';
import type { DockSection, Playlist, TopTab, Track } from '@/lib/types';
import { CoverImage } from './CoverImage';
import { TrackListPanel } from './TrackListPanel';

interface SecondaryViewsProps {
  dockSection: DockSection;
  topTab: TopTab;
  allTracks: Track[];
  currentTrackId: string;
  isPlaying: boolean;
  likedIds: Set<string>;
  playlists: Playlist[];
  queueIds: string[];
  searchQuery: string;
  searchResults: Track[];
  searchLoading: boolean;
  volume: number;
  onSearchChange: (q: string) => void;
  onPlayTrack: (track: Track, customQueue?: Track[]) => void;
  onToggleLike: (trackId: string) => void;
  onAddToQueue: (track: Track) => void;
  onAddToPlaylist: (playlistId: string, trackId: string) => void;
  onRemoveFromPlaylist: (playlistId: string, trackId: string) => void;
  onCreatePlaylist: (name: string, description: string) => void;
  onUploadFiles: (files: FileList) => void;
  onAddAudioUrl: (title: string, artist: string, url: string) => void;
  onRemoveFromQueue: (trackId: string) => void;
  onVolumeChange: (vol: number) => void;
  onGoDiscover: () => void;
}

export function SecondaryViews({
  dockSection,
  topTab,
  allTracks,
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
  onUploadFiles,
  onAddAudioUrl,
  onRemoveFromQueue,
  onVolumeChange,
  onGoDiscover,
}: SecondaryViewsProps) {
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(
    playlists[0]?.id ?? null
  );
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [creatingPlaylist, setCreatingPlaylist] = useState(false);

  const [selectedArtist, setSelectedArtist] = useState<string | null>(null);
  const [selectedAlbum, setSelectedAlbum] = useState<string | null>(null);
  const [selectedGenre, setSelectedGenre] = useState<string>('All');

  const [urlTitle, setUrlTitle] = useState('');
  const [urlArtist, setUrlArtist] = useState('');
  const [urlStream, setUrlStream] = useState('');
  const [urlError, setUrlError] = useState('');

  // 1. SEARCH VIEW
  if (dockSection === 'search') {
    const displayedTracks = searchQuery.trim() ? searchResults : allTracks;
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
            placeholder="Search any song, artist, or album..."
            className="w-full bg-transparent text-sm text-white placeholder:text-white/45 focus:outline-none"
          />
          {searchLoading && <Loader2 className="w-4 h-4 text-white/60 animate-spin shrink-0" />}
        </div>

        <div className="flex items-center justify-between px-1">
          <h2 className="font-display text-sm font-semibold text-white/90">
            {searchQuery.trim() ? `Results for "${searchQuery}"` : 'Explore catalog'}
          </h2>
          <span className="text-xs text-white/50 font-mono-tabular">
            {displayedTracks.length} {displayedTracks.length === 1 ? 'track' : 'tracks'}
          </span>
        </div>

        <TrackListPanel
          tracks={displayedTracks}
          currentTrackId={currentTrackId}
          isPlaying={isPlaying}
          likedIds={likedIds}
          playlists={playlists}
          onPlayTrack={(track) => onPlayTrack(track, displayedTracks)}
          onToggleLike={onToggleLike}
          onAddToQueue={onAddToQueue}
          onAddToPlaylist={onAddToPlaylist}
          emptyMessage="No matching songs found. Try another artist or song title."
        />
      </div>
    );
  }

  // 2. LIBRARY & UPLOAD VIEW
  if (dockSection === 'library') {
    const queueTracks = queueIds
      .map((id) => allTracks.find((t) => t.id === id))
      .filter((t): t is Track => Boolean(t));

    const handleUrlSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      if (!urlTitle.trim() || !urlStream.trim()) {
        setUrlError('Provide both a song title and an audio stream URL.');
        return;
      }
      setUrlError('');
      onAddAudioUrl(urlTitle.trim(), urlArtist.trim() || 'Custom Track', urlStream.trim());
      setUrlTitle('');
      setUrlArtist('');
      setUrlStream('');
    };

    return (
      <div className="flex flex-col gap-4 h-full">
        {/* Upload Local Audio & Stream URL */}
        <div className="rounded-[24px] bg-white/[0.05] border border-white/[0.11] p-4 space-y-3.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-base font-semibold text-white">
                Your Music Library
              </h2>
              <p className="text-xs text-white/55">
                Upload local MP3, WAV, M4A, or OGG files to play any music directly.
              </p>
            </div>
            <label className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white text-[#0a0c12] text-xs font-semibold cursor-pointer hover:bg-white/90 transition-colors whitespace-nowrap shrink-0">
              <Upload className="w-3.5 h-3.5" />
              <span>Upload Audio</span>
              <input
                type="file"
                accept="audio/*"
                multiple
                className="sr-only"
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) {
                    onUploadFiles(e.target.files);
                    e.target.value = '';
                  }
                }}
              />
            </label>
          </div>

          <form onSubmit={handleUrlSubmit} className="grid grid-cols-1 sm:grid-cols-12 gap-2 pt-1">
            <input
              type="text"
              aria-label="Track title"
              placeholder="Track title"
              value={urlTitle}
              onChange={(e) => setUrlTitle(e.target.value)}
              className="sm:col-span-3 rounded-xl bg-white/[0.06] border border-white/10 px-3 py-2 text-xs text-white placeholder:text-white/40 focus:outline-none focus:border-white/30"
            />
            <input
              type="text"
              aria-label="Artist name"
              placeholder="Artist (optional)"
              value={urlArtist}
              onChange={(e) => setUrlArtist(e.target.value)}
              className="sm:col-span-3 rounded-xl bg-white/[0.06] border border-white/10 px-3 py-2 text-xs text-white placeholder:text-white/40 focus:outline-none focus:border-white/30"
            />
            <input
              type="url"
              aria-label="Direct audio URL"
              placeholder="https://...mp3 or .m4a URL"
              value={urlStream}
              onChange={(e) => setUrlStream(e.target.value)}
              className="sm:col-span-4 rounded-xl bg-white/[0.06] border border-white/10 px-3 py-2 text-xs text-white placeholder:text-white/40 focus:outline-none focus:border-white/30"
            />
            <button
              type="submit"
              className="sm:col-span-2 inline-flex items-center justify-center gap-1.5 rounded-xl bg-white/15 hover:bg-white/25 border border-white/15 px-3 py-2 text-xs font-medium text-white transition-colors whitespace-nowrap"
            >
              <Link2 className="w-3.5 h-3.5" />
              <span>Add</span>
            </button>
          </form>
          {urlError && <p className="text-xs text-rose-300">{urlError}</p>}
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
          {queueTracks.map((track, idx) => (
            <div
              key={`${track.id}-${idx}`}
              className={cn(
                'flex items-center justify-between gap-3 px-2.5 py-2 rounded-2xl',
                track.id === currentTrackId ? 'bg-white/[0.1]' : 'hover:bg-white/[0.05]'
              )}
            >
              <button
                type="button"
                onClick={() => onPlayTrack(track)}
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
          ))}
        </div>
      </div>
    );
  }

  // 3. LIKES VIEW
  if (dockSection === 'likes') {
    const likedTracks = allTracks.filter((t) => likedIds.has(t.id));
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
                {likedTracks.length} {likedTracks.length === 1 ? 'track' : 'tracks'} saved
              </p>
            </div>
          </div>
          {likedTracks.length > 0 && (
            <button
              type="button"
              onClick={() => onPlayTrack(likedTracks[0], likedTracks)}
              className="px-4 py-2 rounded-full bg-white text-[#090b10] text-xs font-semibold flex items-center gap-1.5 hover:bg-white/90 whitespace-nowrap"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Play All</span>
            </button>
          )}
        </div>

        <TrackListPanel
          tracks={likedTracks}
          currentTrackId={currentTrackId}
          isPlaying={isPlaying}
          likedIds={likedIds}
          playlists={playlists}
          onPlayTrack={(track) => onPlayTrack(track, likedTracks)}
          onToggleLike={onToggleLike}
          onAddToQueue={onAddToQueue}
          onAddToPlaylist={onAddToPlaylist}
          emptyMessage="Tap the heart icon on any track to collect your favorites here."
        />
      </div>
    );
  }

  // 4. PROFILE VIEW
  if (dockSection === 'profile') {
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
              {allTracks.length} Tracks · {likedIds.size} Liked · {playlists.length} Playlists
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
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 5. TOP TABS WHEN DOCK === 'home'
  if (topTab === 'Playlists') {
    const activePlaylist =
      playlists.find((p) => p.id === selectedPlaylistId) ?? playlists[0] ?? null;
    const playlistTracks = activePlaylist
      ? activePlaylist.trackIds
          .map((id) => allTracks.find((t) => t.id === id))
          .filter((t): t is Track => Boolean(t))
      : [];

    const handleCreate = (e: React.FormEvent) => {
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
            {playlists.map((pl) => (
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
            ))}
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
          onPlayTrack={(t) => onPlayTrack(t, playlistTracks)}
          onToggleLike={onToggleLike}
          onAddToQueue={onAddToQueue}
          onAddToPlaylist={(pid, tid) => {
            if (pid === activePlaylist?.id) {
              onRemoveFromPlaylist(pid, tid);
            } else {
              onAddToPlaylist(pid, tid);
            }
          }}
          emptyMessage="This playlist is empty. Use the ··· menu on any track to add songs."
        />
      </div>
    );
  }

  if (topTab === 'Artists') {
    const artistGroups = groupTracksByArtist(allTracks);
    const activeGroup =
      artistGroups.find((g) => g.artist === selectedArtist) ?? artistGroups[0] ?? null;

    return (
      <div className="flex flex-col gap-4 h-full">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          {artistGroups.slice(0, 6).map((group) => (
            <button
              key={group.artist}
              type="button"
              onClick={() => setSelectedArtist(group.artist)}
              className={cn(
                'flex items-center gap-3 p-2.5 rounded-2xl border text-left transition-colors',
                activeGroup?.artist === group.artist
                  ? 'bg-white/[0.12] border-white/30'
                  : 'bg-white/[0.045] border-white/[0.08] hover:bg-white/[0.08]'
              )}
            >
              <CoverImage
                src={group.coverSrc}
                alt={group.artist}
                className="w-10 h-10 rounded-full object-cover shrink-0"
              />
              <div className="min-w-0">
                <p className="text-xs font-semibold text-white truncate">{group.artist}</p>
                <p className="text-[11px] text-white/55">
                  {group.trackCount} {group.trackCount === 1 ? 'track' : 'tracks'}
                </p>
              </div>
            </button>
          ))}
        </div>

        <TrackListPanel
          tracks={activeGroup?.tracks ?? []}
          currentTrackId={currentTrackId}
          isPlaying={isPlaying}
          likedIds={likedIds}
          playlists={playlists}
          onPlayTrack={(t) => onPlayTrack(t, activeGroup?.tracks)}
          onToggleLike={onToggleLike}
          onAddToQueue={onAddToQueue}
          onAddToPlaylist={onAddToPlaylist}
        />
      </div>
    );
  }

  if (topTab === 'Albums') {
    const albumGroups = groupTracksByAlbum(allTracks);
    const activeAlbum =
      albumGroups.find((g) => g.album === selectedAlbum) ?? albumGroups[0] ?? null;

    return (
      <div className="flex flex-col gap-4 h-full">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          {albumGroups.slice(0, 6).map((group) => (
            <button
              key={`${group.album}-${group.artist}`}
              type="button"
              onClick={() => setSelectedAlbum(group.album)}
              className={cn(
                'flex items-center gap-3 p-2.5 rounded-2xl border text-left transition-colors',
                activeAlbum?.album === group.album
                  ? 'bg-white/[0.12] border-white/30'
                  : 'bg-white/[0.045] border-white/[0.08] hover:bg-white/[0.08]'
              )}
            >
              <CoverImage
                src={group.coverSrc}
                alt={group.album}
                className="w-10 h-10 rounded-xl object-cover shrink-0"
              />
              <div className="min-w-0">
                <p className="text-xs font-semibold text-white truncate">{group.album}</p>
                <p className="text-[11px] text-white/55 truncate">
                  {group.artist} · {group.year}
                </p>
              </div>
            </button>
          ))}
        </div>

        <TrackListPanel
          tracks={activeAlbum?.tracks ?? []}
          currentTrackId={currentTrackId}
          isPlaying={isPlaying}
          likedIds={likedIds}
          playlists={playlists}
          onPlayTrack={(t) => onPlayTrack(t, activeAlbum?.tracks)}
          onToggleLike={onToggleLike}
          onAddToQueue={onAddToQueue}
          onAddToPlaylist={onAddToPlaylist}
        />
      </div>
    );
  }

  // GENRES TAB
  const genres = ['All', ...Array.from(new Set(allTracks.map((t) => t.genre)))];
  const genreTracks = filterTracksByGenre(allTracks, selectedGenre);

  return (
    <div className="flex flex-col gap-4 h-full">
      <div className="flex items-center gap-2 overflow-x-auto waven-scroll pb-1">
        {genres.map((g) => (
          <button
            key={g}
            type="button"
            onClick={() => setSelectedGenre(g)}
            className={cn(
              'px-3.5 py-2 rounded-full text-xs font-medium border transition-colors whitespace-nowrap shrink-0',
              selectedGenre === g
                ? 'bg-white text-[#090b10] border-white'
                : 'bg-white/[0.06] text-white/80 border-white/10 hover:bg-white/[0.12]'
            )}
          >
            {g}
          </button>
        ))}
      </div>

      <TrackListPanel
        tracks={genreTracks}
        currentTrackId={currentTrackId}
        isPlaying={isPlaying}
        likedIds={likedIds}
        playlists={playlists}
        onPlayTrack={(t) => onPlayTrack(t, genreTracks)}
        onToggleLike={onToggleLike}
        onAddToQueue={onAddToQueue}
        onAddToPlaylist={onAddToPlaylist}
      />
    </div>
  );
}

// Keep unused icon imports clean if needed
void Disc3;
void Music2;
void User;
