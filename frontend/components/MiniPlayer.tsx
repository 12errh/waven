'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { Heart, Maximize2, Pause, Play, SkipBack, SkipForward, X } from 'lucide-react';
import { formatTimeMMSS } from '@/lib/player-logic';
import { isNarrowMini, miniProgressRatio, miniSeekRatio } from '@/lib/mini';
import type { Track } from '@/lib/types';
import { cn } from '@/lib/utils';
import { CoverImage } from './CoverImage';

interface MiniPlayerProps {
  track: Track | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  isLiked: boolean;
  onTogglePlay: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSeek: (seconds: number) => void;
  onToggleLike: () => void;
  onExpand: () => void;
  onHide: () => void;
}

/**
 * Compact window layout: cover, track, transport, and a thin progress strip.
 * The whole shell is a drag strip; controls opt out with `.wails-no-drag`. The
 * window itself is resized by the Go shell, so this component only adapts its
 * own layout down to the 320px minimum width.
 */
export function MiniPlayer({
  track,
  isPlaying,
  currentTime,
  duration,
  isLiked,
  onTogglePlay,
  onPrev,
  onNext,
  onSeek,
  onToggleLike,
  onExpand,
  onHide,
}: MiniPlayerProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const progressRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  const [narrow, setNarrow] = useState(false);

  const durationSec = Math.max(duration, track?.durationSec ?? 0);
  const ratio = miniProgressRatio(currentTime, durationSec);
  const elapsed = formatTimeMMSS(Math.floor(currentTime));
  const total = durationSec > 0 ? formatTimeMMSS(Math.floor(durationSec)) : '--:--';

  // The compact frame can be dragged to its 320px minimum; hide secondary
  // controls there instead of letting them overlap the title.
  useEffect(() => {
    const element = rootRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      setNarrow(isNarrowMini(width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const seekToClientX = useCallback(
    (clientX: number) => {
      const rect = progressRef.current?.getBoundingClientRect();
      if (!rect) return;
      onSeek(miniSeekRatio(clientX, rect.left, rect.width) * durationSec);
    },
    [durationSec, onSeek]
  );

  const handleProgressPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      draggingRef.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      seekToClientX(event.clientX);
    },
    [seekToClientX]
  );

  const handleProgressPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      seekToClientX(event.clientX);
    },
    [seekToClientX]
  );

  const endProgressDrag = useCallback(() => {
    draggingRef.current = false;
  }, []);

  const handleProgressKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (!durationSec) return;
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        onSeek(Math.min(durationSec, currentTime + 5));
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        onSeek(Math.max(0, currentTime - 5));
      } else if (event.key === 'Home') {
        event.preventDefault();
        onSeek(0);
      } else if (event.key === 'End') {
        event.preventDefault();
        onSeek(Math.max(0, durationSec - 1));
      }
    },
    [currentTime, durationSec, onSeek]
  );

  return (
    <div
      ref={rootRef}
      data-window-layout="mini"
      className="wails-drag flex h-dvh max-h-dvh w-full select-none flex-col overflow-hidden rounded-2xl border border-white/[0.14] bg-[#0a0c12]/85 text-white shadow-[0_24px_60px_rgba(0,0,0,0.65)] backdrop-blur-2xl"
      title="Double-click to expand WAVEN"
      onDoubleClick={(event) => {
        if ((event.target as HTMLElement).closest('button')) return;
        onExpand();
      }}
    >
      <div className="flex min-h-0 flex-1 items-center gap-3 px-3 pt-3">
        <CoverImage
          src={track?.coverSrc ?? ''}
          alt={track ? `${track.album || track.title} cover` : 'No cover'}
          className="h-16 w-16 shrink-0 rounded-xl object-cover"
        />

        <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
          <p
            data-mini-title=""
            className="truncate font-display text-sm font-semibold leading-tight text-white"
          >
            {track?.title ?? 'Nothing playing'}
          </p>
          <p className="truncate text-[11px] leading-tight text-white/60">
            {track?.artist || 'WAVEN'}
          </p>
          <div className={cn('flex items-center gap-2 pt-0.5', narrow && 'gap-1')}>
            <span className="font-mono-tabular text-[10px] text-white/50">{elapsed}</span>
            <span className="font-mono-tabular text-[10px] text-white/30">{total}</span>
          </div>
        </div>

        <div className="wails-no-drag flex shrink-0 items-center gap-1">
          <button
            type="button"
            aria-label="Previous track"
            title="Previous (P)"
            onClick={onPrev}
            disabled={!track}
            className="flex h-8 w-8 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 disabled:opacity-35"
          >
            <SkipBack className="h-4 w-4" strokeWidth={1.8} />
          </button>
          <button
            type="button"
            aria-label={isPlaying ? 'Pause playback' : 'Play'}
            title="Play or pause (Space)"
            onClick={onTogglePlay}
            disabled={!track}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-[#090b10] transition-colors hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:opacity-35"
          >
            {isPlaying ? (
              <Pause className="h-4 w-4" strokeWidth={2} />
            ) : (
              <Play className="ml-0.5 h-4 w-4" strokeWidth={2} />
            )}
          </button>
          <button
            type="button"
            aria-label="Next track"
            title="Next (N)"
            onClick={onNext}
            disabled={!track}
            className="flex h-8 w-8 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 disabled:opacity-35"
          >
            <SkipForward className="h-4 w-4" strokeWidth={1.8} />
          </button>
        </div>

        <div className="wails-no-drag flex shrink-0 items-center gap-0.5">
          {!narrow && track && (
            <button
              type="button"
              aria-label={isLiked ? 'Remove from liked songs' : 'Add to liked songs'}
              aria-pressed={isLiked}
              title="Like (L)"
              onClick={onToggleLike}
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60',
                isLiked ? 'text-rose-300 hover:bg-white/10' : 'text-white/45 hover:bg-white/10 hover:text-white'
              )}
            >
              <Heart className={cn('h-3.5 w-3.5', isLiked && 'fill-current')} strokeWidth={1.8} />
            </button>
          )}
          <button
            type="button"
            aria-label="Expand to full player"
            title="Expand (Esc or double-click)"
            onClick={onExpand}
            className="flex h-7 w-7 items-center justify-center rounded-full text-white/45 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          >
            <Maximize2 className="h-3.5 w-3.5" strokeWidth={1.8} />
          </button>
          <button
            type="button"
            aria-label="Hide WAVEN"
            title="Hide to tray"
            onClick={onHide}
            className="flex h-7 w-7 items-center justify-center rounded-full text-white/45 transition-colors hover:bg-red-500/80 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          >
            <X className="h-3.5 w-3.5" strokeWidth={1.8} />
          </button>
        </div>
      </div>

      {/* Seek strip. It sits on the window edge, so it uses pointer capture
          instead of a range input and keeps the drag local to the shell. */}
      <div
        ref={progressRef}
        role="slider"
        tabIndex={0}
        aria-label="Seek track progress"
        aria-valuemin={0}
        aria-valuemax={Math.round(durationSec)}
        aria-valuenow={Math.round(currentTime)}
        aria-valuetext={`${elapsed} of ${total}`}
        onPointerDown={handleProgressPointerDown}
        onPointerMove={handleProgressPointerMove}
        onPointerUp={endProgressDrag}
        onPointerCancel={endProgressDrag}
        onKeyDown={handleProgressKeyDown}
        className="wails-no-drag group relative mx-2 mb-2 mt-1 flex h-3 shrink-0 cursor-pointer items-center focus-visible:outline-none"
      >
        <div className="h-1 w-full overflow-hidden rounded-full bg-white/20">
          <div
            className="h-full rounded-full bg-white transition-[width] duration-100"
            style={{ width: `${ratio * 100}%` }}
          />
        </div>
        <span
          aria-hidden="true"
          className="absolute h-2.5 w-2.5 -translate-x-1/2 rounded-full bg-white shadow-md opacity-0 transition-opacity group-hover:opacity-100"
          style={{ left: `${ratio * 100}%` }}
        />
        <span className="pointer-events-none absolute inset-0 rounded-full ring-white/70 group-focus-visible:ring-2" />
      </div>
    </div>
  );
}
