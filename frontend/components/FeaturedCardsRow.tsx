'use client';

import { Heart, Pause, Play } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Track } from '@/lib/types';
import { CoverImage } from './CoverImage';

interface FeaturedCardsRowProps {
  tracks: Track[];
  currentTrackId: number | null;
  isPlaying: boolean;
  likedIds: Set<number>;
  onPlayTrack: (track: Track) => void;
  onToggleLike: (trackId: number) => void;
}

export function FeaturedCardsRow({
  tracks,
  currentTrackId,
  isPlaying,
  likedIds,
  onPlayTrack,
  onToggleLike,
}: FeaturedCardsRowProps) {
  const cardTilts = [
    'lg:rotate-0 lg:z-20',
    'lg:-rotate-[1deg] lg:z-10 lg:-ml-2',
    'lg:rotate-[9deg] lg:translate-y-1.5 lg:z-0 lg:-ml-2 hover:lg:rotate-0 hover:lg:translate-y-0 hover:lg:z-30',
  ];

  return (
    <section aria-label="Featured new releases" className="w-full min-w-0">
      <div className="flex sm:grid sm:grid-cols-3 gap-3 sm:gap-2.5 lg:gap-1.5 items-center overflow-x-auto sm:overflow-visible snap-x snap-mandatory waven-scroll pb-1 sm:pb-0">
        {tracks.slice(0, 3).map((track, idx) => {
          const isCurrent = track.id === currentTrackId;
          const isTrackPlaying = isCurrent && isPlaying;
          const isLiked = likedIds.has(track.id);

          return (
            <article
              key={track.id}
              className={cn(
                'group relative w-[205px] sm:w-auto shrink-0 snap-start h-[225px] sm:h-[222px] rounded-[24px] overflow-hidden notched-card-mask shadow-[0_18px_40px_rgba(0,0,0,0.55)] transition-all duration-300 ease-out border border-white/[0.12]',
                cardTilts[idx] ?? ''
              )}
            >
              <CoverImage
                src={track.coverSrc}
                alt={`${track.title} by ${track.artist}`}
                className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
              />

              {/* Subtle scrim for crisp readability */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-black/15 pointer-events-none" />

              {/* Accessible full-card click target behind interactive controls */}
              <button
                type="button"
                aria-label={`${isTrackPlaying ? 'Pause' : 'Play'} ${track.title} by ${track.artist}`}
                onClick={() => onPlayTrack(track)}
                className="absolute inset-0 z-10 w-full h-full cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/60"
              />

              {/* Top Row: Release Tag & Heart Button */}
              <div className="relative z-20 flex items-center justify-between px-3.5 pt-3.5 pointer-events-none">
                <span className="px-2.5 py-0.5 rounded-full bg-white/15 backdrop-blur-md border border-white/15 text-[10px] font-medium text-white/90 whitespace-nowrap">
                  {track.genre || (track.format ? track.format.toUpperCase() : 'Local file')}
                </span>

                <button
                  type="button"
                  aria-label={isLiked ? `Unlike ${track.title}` : `Like ${track.title}`}
                  onClick={() => onToggleLike(track.id)}
                  className={cn(
                    'pointer-events-auto w-8 h-8 rounded-full flex items-center justify-center backdrop-blur-md border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60',
                    isLiked
                      ? 'bg-white/25 border-white/40 text-white'
                      : 'bg-black/25 border-white/20 text-white/80 hover:text-white hover:bg-white/20'
                  )}
                >
                  <Heart className={cn('w-3.5 h-3.5', isLiked && 'fill-white')} />
                </button>
              </div>

              {/* Bottom Info & Circular White Play Trigger */}
              <div className="absolute inset-x-0 bottom-0 z-20 p-3.5 flex items-end justify-between gap-2 pointer-events-none">
                <div className="min-w-0">
                  <h3 className="font-display text-[13px] sm:text-sm font-bold uppercase tracking-wide text-white truncate">
                    {track.title}
                  </h3>
                  <p className="text-[11px] text-white/80 truncate">{track.artist}</p>
                  <p className="text-[10px] text-white/55 truncate mt-1">
                    {[track.year > 0 ? String(track.year) : '', track.format.toUpperCase()]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>

                <button
                  type="button"
                  aria-label={isTrackPlaying ? `Pause ${track.title}` : `Play ${track.title}`}
                  onClick={() => onPlayTrack(track)}
                  className="pointer-events-auto w-9 h-9 rounded-full bg-white text-[#090b10] flex items-center justify-center shrink-0 shadow-[0_6px_18px_rgba(0,0,0,0.45)] hover:scale-105 active:scale-95 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                >
                  {isTrackPlaying ? (
                    <Pause className="w-4 h-4 fill-current" />
                  ) : (
                    <Play className="w-4 h-4 fill-current ml-0.5" />
                  )}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
