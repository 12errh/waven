'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowDown,
  ArrowUp,
  Heart,
  ListPlus,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatTrackRowDuration } from '@/lib/player-logic';
import type { Playlist, Track } from '@/lib/types';
import { CoverImage } from './CoverImage';

interface TrackListPanelProps {
  tracks: Track[];
  currentTrackId: number | null;
  isPlaying: boolean;
  likedIds: Set<number>;
  playlists: Playlist[];
  onPlayTrack: (track: Track) => void;
  onToggleLike: (trackId: number) => void;
  onAddToQueue: (track: Track) => void;
  onAddToPlaylist: (playlistId: number, trackId: number) => void;
  /** Search cursor highlight; the row also receives its position index. */
  activeTrackId?: number | null;
  trackIndexOffset?: number;
  /** Playlist editing actions; omitted elsewhere. */
  onRemoveTrack?: (trackId: number) => void;
  onMoveTrack?: (trackId: number, direction: -1 | 1) => void;
  emptyMessage?: string;
}

export function TrackListPanel({
  tracks,
  currentTrackId,
  isPlaying,
  likedIds,
  playlists,
  onPlayTrack,
  onToggleLike,
  onAddToQueue,
  onAddToPlaylist,
  activeTrackId = null,
  trackIndexOffset = 0,
  onRemoveTrack,
  onMoveTrack,
  emptyMessage = 'No tracks available.',
}: TrackListPanelProps) {
  const [openMenu, setOpenMenu] = useState<{ track: Track; anchor: DOMRect } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const editable = Boolean(onRemoveTrack || onMoveTrack);

  // The row menu is portalled to the body so the scroll container cannot clip
  // it. Its position is measured after mount and flips above the trigger when
  // there is no room below.
  useLayoutEffect(() => {
    const element = menuRef.current;
    const anchor = openMenu?.anchor;
    if (!element || !anchor) return;
    const rect = element.getBoundingClientRect();
    const gap = 6;
    const left = Math.min(
      Math.max(8, anchor.right - rect.width),
      Math.max(8, window.innerWidth - rect.width - 8)
    );
    const below = anchor.bottom + gap;
    const above = anchor.top - rect.height - gap;
    const top =
      below + rect.height <= window.innerHeight - 8 ? below : Math.max(8, above);
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
  }, [openMenu]);

  useEffect(() => {
    if (!openMenu) return;
    const close = () => setOpenMenu(null);
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && menuRef.current?.contains(target)) return;
      setOpenMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [openMenu]);

  return (
    <section
      aria-label="Track list"
      className="relative rounded-[26px] bg-white/[0.045] backdrop-blur-2xl border border-white/[0.1] p-2.5 sm:p-3.5 flex-1 flex flex-col justify-between shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
    >
      {tracks.length === 0 ? (
        <div className="flex-1 flex items-center justify-center py-12 text-sm text-white/55">
          {emptyMessage}
        </div>
      ) : (
        <ul className="space-y-1 max-h-[320px] overflow-y-auto waven-scroll pr-0.5">
          {tracks.map((track, index) => {
            const isCurrent = track.id === currentTrackId;
            const isTrackPlaying = isCurrent && isPlaying;
            const isLiked = likedIds.has(track.id);
            const menuOpen = openMenu?.track.id === track.id;
            const isActive = track.id === activeTrackId;

            return (
              <li
                key={track.id}
                data-search-index={trackIndexOffset + index}
                aria-current={isActive ? 'true' : undefined}
                onMouseDown={(event) => event.preventDefault()}
                className={cn(
                  'group relative flex items-center justify-between gap-3 px-2.5 py-2 rounded-2xl transition-colors',
                  isCurrent
                    ? 'bg-white/[0.09]'
                    : isActive
                      ? 'bg-white/[0.12]'
                      : 'hover:bg-white/[0.05]'
                )}
              >
                {/* Playable track info button */}
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={`${isTrackPlaying ? 'Pause' : 'Play'} ${track.title} by ${track.artist}`}
                  onClick={() => onPlayTrack(track)}
                  className="flex items-center gap-3.5 min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 rounded-xl"
                >
                  <div className="relative w-10 h-10 sm:w-11 sm:h-11 rounded-full overflow-hidden shrink-0 ring-1 ring-white/15">
                    <CoverImage
                      src={track.coverSrc}
                      alt={`${track.title} cover`}
                      className="w-full h-full object-cover"
                    />
                    <div
                      className={cn(
                        'absolute inset-0 bg-black/45 flex items-center justify-center transition-opacity',
                        isCurrent ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                      )}
                    >
                      {isTrackPlaying ? (
                        <Pause className="w-4 h-4 text-white fill-white" />
                      ) : (
                        <Play className="w-4 h-4 text-white fill-white ml-0.5" />
                      )}
                    </div>
                  </div>

                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        'text-sm font-medium truncate',
                        isCurrent ? 'text-white' : 'text-white/95'
                      )}
                    >
                      {track.title}
                    </p>
                    <p className="text-[11px] text-white/55 truncate">
                      {track.artist}
                      {track.album && track.album !== track.title ? ` · ${track.album}` : ''}
                    </p>
                  </div>
                </button>

                {/* Duration & Action Buttons */}
                <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
                  {editable && (
                    <div className="hidden sm:flex items-center gap-1">
                      {onMoveTrack && (
                        <>
                          <button
                            type="button"
                            tabIndex={-1}
                            aria-label={`Move ${track.title} up`}
                            disabled={index === 0}
                            onClick={() => onMoveTrack(track.id, -1)}
                            className="w-7 h-7 rounded-full flex items-center justify-center text-white/55 hover:text-white hover:bg-white/10 disabled:opacity-25 disabled:hover:bg-transparent transition-colors"
                          >
                            <ArrowUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            tabIndex={-1}
                            aria-label={`Move ${track.title} down`}
                            disabled={index === tracks.length - 1}
                            onClick={() => onMoveTrack(track.id, 1)}
                            className="w-7 h-7 rounded-full flex items-center justify-center text-white/55 hover:text-white hover:bg-white/10 disabled:opacity-25 disabled:hover:bg-transparent transition-colors"
                          >
                            <ArrowDown className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                      {onRemoveTrack && (
                        <button
                          type="button"
                          tabIndex={-1}
                          aria-label={`Remove ${track.title} from playlist`}
                          onClick={() => onRemoveTrack(track.id)}
                          className="w-7 h-7 rounded-full flex items-center justify-center text-white/55 hover:text-rose-200 hover:bg-rose-500/15 transition-colors"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  )}

                  <span className="font-mono-tabular text-xs text-white/65 mr-1 sm:mr-3 w-10 text-right">
                    {formatTrackRowDuration(track.durationSec)}
                  </span>

                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label={isLiked ? `Unlike ${track.title}` : `Like ${track.title}`}
                    onClick={() => onToggleLike(track.id)}
                    className={cn(
                      'w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50',
                      isLiked
                        ? 'bg-white/20 border-white/35 text-white'
                        : 'bg-white/[0.05] border-white/[0.08] text-white/65 hover:text-white hover:bg-white/[0.12]'
                    )}
                  >
                    <Heart className={cn('w-3.5 h-3.5', isLiked && 'fill-white')} />
                  </button>

                  <div className="relative">
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-label={`More options for ${track.title}`}
                      aria-expanded={menuOpen}
                      onClick={(event) => {
                        if (menuOpen) {
                          setOpenMenu(null);
                          return;
                        }
                        setOpenMenu({
                          track,
                          anchor: event.currentTarget.getBoundingClientRect(),
                        });
                      }}
                      className="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-white/[0.05] border border-white/[0.08] text-white/65 hover:text-white hover:bg-white/[0.12] flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
                    >
                      <MoreHorizontal className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {openMenu &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label={`Options for ${openMenu.track.title}`}
            style={{ position: 'fixed', left: -9999, top: -9999 }}
            className="z-[90] w-48 rounded-2xl bg-[#181b23]/95 backdrop-blur-2xl border border-white/15 p-1.5 shadow-[0_18px_45px_rgba(0,0,0,0.75)]"
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onAddToQueue(openMenu.track);
                setOpenMenu(null);
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs text-white/90 hover:bg-white/10 text-left"
            >
              <ListPlus className="w-3.5 h-3.5 text-white/70" />
              <span>Add to queue</span>
            </button>

            <div className="mt-1 pt-1 border-t border-white/10">
              <p className="px-3 py-1 text-[10px] font-medium text-white/45">
                Add to playlist
              </p>
              {playlists.length === 0 ? (
                <p className="px-3 pb-1.5 pt-0.5 text-[11px] leading-snug text-white/50">
                  Create a playlist in the Library tab first.
                </p>
              ) : (
                playlists.map((pl) => (
                  <button
                    key={pl.id}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      onAddToPlaylist(pl.id, openMenu.track.id);
                      setOpenMenu(null);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs text-white/85 hover:bg-white/10 text-left"
                  >
                    <Plus className="w-3 h-3 text-white/60 shrink-0" />
                    <span className="truncate">{pl.name}</span>
                  </button>
                ))
              )}
            </div>
          </div>,
          document.body
        )}
    </section>
  );
}
