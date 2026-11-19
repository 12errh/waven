'use client';

import { useState } from 'react';
import { Heart, ListPlus, MoreHorizontal, Play, Pause, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatTrackRowDuration } from '@/lib/player-logic';
import type { Playlist, Track } from '@/lib/types';
import { CoverImage } from './CoverImage';

interface TrackListPanelProps {
  tracks: Track[];
  currentTrackId: string;
  isPlaying: boolean;
  likedIds: Set<string>;
  playlists: Playlist[];
  onPlayTrack: (track: Track) => void;
  onToggleLike: (trackId: string) => void;
  onAddToQueue: (track: Track) => void;
  onAddToPlaylist: (playlistId: string, trackId: string) => void;
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
  emptyMessage = 'No tracks available.',
}: TrackListPanelProps) {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

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
          {tracks.map((track) => {
            const isCurrent = track.id === currentTrackId;
            const isTrackPlaying = isCurrent && isPlaying;
            const isLiked = likedIds.has(track.id);
            const menuOpen = openMenuId === track.id;

            return (
              <li
                key={track.id}
                className={cn(
                  'group relative flex items-center justify-between gap-3 px-2.5 py-2 rounded-2xl transition-colors',
                  isCurrent ? 'bg-white/[0.09]' : 'hover:bg-white/[0.05]'
                )}
              >
                {/* Playable track info button */}
                <button
                  type="button"
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
                  <span className="font-mono-tabular text-xs text-white/65 mr-1 sm:mr-3 w-10 text-right">
                    {formatTrackRowDuration(track.durationSec)}
                  </span>

                  <button
                    type="button"
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
                      aria-label={`More options for ${track.title}`}
                      aria-expanded={menuOpen}
                      onClick={() => setOpenMenuId(menuOpen ? null : track.id)}
                      className="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-white/[0.05] border border-white/[0.08] text-white/65 hover:text-white hover:bg-white/[0.12] flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
                    >
                      <MoreHorizontal className="w-4 h-4" />
                    </button>

                    {menuOpen && (
                      <div
                        role="menu"
                        className="absolute right-0 bottom-10 z-40 w-48 rounded-2xl bg-[#181b23]/95 backdrop-blur-2xl border border-white/15 p-1.5 shadow-[0_18px_45px_rgba(0,0,0,0.75)]"
                      >
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            onAddToQueue(track);
                            setOpenMenuId(null);
                          }}
                          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs text-white/90 hover:bg-white/10 text-left"
                        >
                          <ListPlus className="w-3.5 h-3.5 text-white/70" />
                          <span>Add to queue</span>
                        </button>

                        {playlists.length > 0 && (
                          <div className="mt-1 pt-1 border-t border-white/10">
                            <p className="px-3 py-1 text-[10px] font-medium text-white/45">
                              Add to playlist
                            </p>
                            {playlists.map((pl) => (
                              <button
                                key={pl.id}
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                  onAddToPlaylist(pl.id, track.id);
                                  setOpenMenuId(null);
                                }}
                                className="w-full flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs text-white/85 hover:bg-white/10 text-left truncate"
                              >
                                <Plus className="w-3 h-3 text-white/60 shrink-0" />
                                <span className="truncate">{pl.name}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
