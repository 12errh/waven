'use client';

import { useState } from 'react';
import {
  Disc3,
  Heart,
  ListMusic,
  MoreHorizontal,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { computeSeekTime, formatTimeMMSS, formatTrackQuality } from '@/lib/player-logic';
import type { Playlist, RepeatMode, Track } from '@/lib/types';
import { CoverImage } from './CoverImage';
import { Visualizer } from './Visualizer';

interface NowPlayingCardProps {
  track: Track | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  isLiked: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  volume: number;
  muted: boolean;
  playlists: Playlist[];
  queueCount: number;
  onTogglePlay: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSeek: (sec: number) => void;
  onToggleLike: (trackId: number) => void;
  onToggleShuffle: () => void;
  onCycleRepeat: () => void;
  onVolumeChange: (vol: number) => void;
  onToggleMute: () => void;
  onAddToPlaylist: (playlistId: number, trackId: number) => void;
  onOpenQueue: () => void;
  onOpenLibrary: () => void;
  readAnalyser: (target: Uint8Array) => boolean;
  /**
   * `tall` is the full artwork card that sits beside the content. `bar` is the
   * compact player pinned below the content when the user moves it there.
   */
  variant?: 'tall' | 'bar';
}

interface TrackMetaProps {
  track: Track;
  quality: string;
  compact: boolean;
}

function TrackMeta({ track, quality, compact }: TrackMetaProps) {
  return (
    <>
      <span
        className={cn(
          'inline-block max-w-full truncate rounded-full border border-white/15 bg-white/15 font-medium text-white/90 backdrop-blur-md',
          compact ? 'px-2 py-0.5 text-[9px]' : 'px-3 py-0.5 text-[10px]'
        )}
      >
        {track.genre || 'Local file'}
      </span>

      <h2
        className={cn(
          'font-display font-bold uppercase leading-tight tracking-wide text-white truncate',
          compact ? 'mt-1 text-lg sm:text-xl' : 'mt-2.5 text-2xl sm:text-[30px]'
        )}
      >
        {track.title}
      </h2>

      <div
        className={cn(
          'flex items-center justify-between gap-3',
          compact ? 'mt-0.5' : 'mt-1'
        )}
      >
        <p className={cn('truncate text-white/80', compact ? 'text-[11px]' : 'text-xs sm:text-sm')}>
          {track.artist}
        </p>
        <span
          className={cn(
            'shrink-0 truncate text-right font-mono-tabular text-white/65',
            compact ? 'max-w-[45%] text-[9px]' : 'max-w-[45%] text-[10px]'
          )}
          title={quality}
        >
          {quality}
        </span>
      </div>
    </>
  );
}

interface SeekBarProps {
  currentTime: number;
  safeDuration: number;
  compact: boolean;
  onSeek: (sec: number) => void;
}

function SeekBar({ currentTime, safeDuration, compact, onSeek }: SeekBarProps) {
  const progressPct =
    safeDuration > 0 ? Math.min(100, (currentTime / safeDuration) * 100) : 0;

  const handleSeekClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    onSeek(computeSeekTime(ratio, safeDuration));
  };

  return (
    <div className={compact ? 'mt-1' : 'mt-3'}>
      <div
        role="slider"
        tabIndex={0}
        aria-label="Seek track progress"
        aria-valuemin={0}
        aria-valuemax={Math.round(safeDuration)}
        aria-valuenow={Math.round(currentTime)}
        onClick={handleSeekClick}
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight') onSeek(Math.min(safeDuration, currentTime + 5));
          if (event.key === 'ArrowLeft') onSeek(Math.max(0, currentTime - 5));
        }}
        className="group relative flex h-2 cursor-pointer items-center focus-visible:outline-none"
      >
        <div className="h-1 w-full overflow-hidden rounded-full bg-white/25">
          <div
            className="h-full rounded-full bg-white transition-[width] duration-100"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <div
          className="absolute h-3 w-3 -translate-x-1/2 rounded-full bg-white opacity-0 shadow-md transition-opacity group-hover:opacity-100"
          style={{ left: `${progressPct}%` }}
        />
      </div>

      <div
        className={cn(
          'mt-1 flex items-center justify-between font-mono-tabular text-white/75',
          compact ? 'text-[10px]' : 'text-[11px]'
        )}
      >
        <span>{formatTimeMMSS(currentTime)}</span>
        <span>{formatTimeMMSS(safeDuration)}</span>
      </div>
    </div>
  );
}

interface TransportProps {
  compact: boolean;
  isPlaying: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  onTogglePlay: () => void;
  onPrev: () => void;
  onNext: () => void;
  onToggleShuffle: () => void;
  onCycleRepeat: () => void;
}

function TransportControls({
  compact,
  isPlaying,
  shuffle,
  repeat,
  onTogglePlay,
  onPrev,
  onNext,
  onToggleShuffle,
  onCycleRepeat,
}: TransportProps) {
  return (
    <div
      className={cn(
        'flex items-center justify-center',
        compact ? 'mt-1 gap-2.5' : 'mt-4 gap-4 sm:gap-6'
      )}
    >
      <button
        type="button"
        aria-label={shuffle ? 'Disable shuffle' : 'Enable shuffle'}
        aria-pressed={shuffle}
        onClick={onToggleShuffle}
        className={cn(
          'flex items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60',
          compact ? 'h-8 w-8' : 'h-10 w-10',
          shuffle ? 'bg-white/15 text-white' : 'text-white/65 hover:text-white'
        )}
      >
        <Shuffle className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
      </button>

      <button
        type="button"
        aria-label="Previous track"
        onClick={onPrev}
        className={cn(
          'flex items-center justify-center rounded-full text-white/90 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60',
          compact ? 'h-8 w-8' : 'h-10 w-10'
        )}
      >
        <SkipBack className={cn('fill-current', compact ? 'h-4 w-4' : 'h-5 w-5')} />
      </button>

      <button
        type="button"
        aria-label={isPlaying ? 'Pause playback' : 'Start playback'}
        onClick={onTogglePlay}
        className={cn(
          'flex items-center justify-center rounded-full bg-white text-[#090b10] shadow-[0_8px_24px_rgba(255,255,255,0.28)] transition-transform hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white',
          compact ? 'h-9 w-9' : 'h-12 w-12'
        )}
      >
        {isPlaying ? (
          <Pause className={cn('fill-current', compact ? 'h-4 w-4' : 'h-5 w-5')} />
        ) : (
          <Play
            className={cn('fill-current', compact ? 'ml-0.5 h-4 w-4' : 'ml-0.5 h-5 w-5')}
          />
        )}
      </button>

      <button
        type="button"
        aria-label="Next track"
        onClick={onNext}
        className={cn(
          'flex items-center justify-center rounded-full text-white/90 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60',
          compact ? 'h-8 w-8' : 'h-10 w-10'
        )}
      >
        <SkipForward className={cn('fill-current', compact ? 'h-4 w-4' : 'h-5 w-5')} />
      </button>

      <button
        type="button"
        aria-label={`Repeat mode: ${repeat}`}
        onClick={onCycleRepeat}
        className={cn(
          'flex items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60',
          compact ? 'h-8 w-8' : 'h-10 w-10',
          repeat !== 'off' ? 'bg-white/15 text-white' : 'text-white/65 hover:text-white'
        )}
      >
        {repeat === 'one' ? (
          <Repeat1 className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
        ) : (
          <Repeat className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
        )}
      </button>
    </div>
  );
}

export function NowPlayingCard({
  track,
  isPlaying,
  currentTime,
  duration,
  isLiked,
  shuffle,
  repeat,
  volume,
  muted,
  playlists,
  queueCount,
  onTogglePlay,
  onPrev,
  onNext,
  onSeek,
  onToggleLike,
  onToggleShuffle,
  onCycleRepeat,
  onVolumeChange,
  onToggleMute,
  onAddToPlaylist,
  onOpenQueue,
  onOpenLibrary,
  readAnalyser,
  variant = 'tall',
}: NowPlayingCardProps) {
  const [optionsOpen, setOptionsOpen] = useState(false);
  const isBar = variant === 'bar';

  if (!track) {
    return (
      <aside
        aria-label="Now playing"
        className={cn(
          'relative w-full overflow-hidden rounded-[28px] border border-white/[0.12] bg-gradient-to-br from-slate-800 via-zinc-900 to-black shadow-[0_24px_65px_rgba(0,0,0,0.6)]',
          isBar
            ? 'flex h-[132px] items-center gap-4 rounded-[24px] px-5 sm:h-[148px]'
            : 'flex min-h-[440px] flex-col items-center justify-center gap-4 p-8 text-center lg:h-full lg:min-h-[540px]'
        )}
      >
        <div
          className={cn(
            'flex items-center justify-center border border-white/10 bg-white/[0.06]',
            isBar ? 'h-14 w-14 shrink-0 rounded-2xl' : 'h-24 w-24 rounded-3xl'
          )}
        >
          <Disc3 className={isBar ? 'h-6 w-6 text-white/35' : 'h-10 w-10 text-white/35'} />
        </div>
        <div className={cn('space-y-1.5', isBar ? 'min-w-0 flex-1 text-left' : 'max-w-[260px]')}>
          <h2
            className={cn(
              'font-display font-semibold text-white',
              isBar ? 'truncate text-sm' : 'text-lg'
            )}
          >
            Nothing playing yet
          </h2>
          <p
            className={cn(
              'leading-relaxed text-white/55',
              isBar ? 'truncate text-[11px]' : 'text-sm'
            )}
          >
            Add a music folder and WAVEN will scan your files, artwork, and tags.
          </p>
        </div>
        <button
          type="button"
          onClick={onOpenLibrary}
          className="shrink-0 rounded-full bg-white px-4 py-2 text-xs font-semibold text-[#090b10] transition-colors hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
        >
          Add music folder
        </button>
      </aside>
    );
  }

  const safeDuration = duration > 0 ? duration : track.durationSec;
  const quality = formatTrackQuality(track);

  const actionControls = (
    <>
      <button
        type="button"
        aria-label={isLiked ? `Unlike ${track.title}` : `Like ${track.title}`}
        onClick={() => onToggleLike(track.id)}
        className={cn(
          'flex items-center justify-center rounded-full border backdrop-blur-xl transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60',
          isBar ? 'h-8 w-8' : 'h-10 w-10',
          isLiked
            ? 'border-white/45 bg-white/25 text-white'
            : 'border-white/25 bg-black/25 text-white/85 hover:bg-white/20 hover:text-white'
        )}
      >
        <Heart
          className={cn(isBar ? 'h-3.5 w-3.5' : 'h-4 w-4', isLiked && 'fill-white')}
        />
      </button>

      <div className="relative">
        <button
          type="button"
          aria-label="Player and queue options"
          aria-expanded={optionsOpen}
          onClick={() => setOptionsOpen(!optionsOpen)}
          className={cn(
            'flex items-center justify-center rounded-full border border-white/25 bg-black/25 text-white/85 backdrop-blur-xl transition-all hover:bg-white/20 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60',
            isBar ? 'h-8 w-8' : 'h-10 w-10'
          )}
        >
          <MoreHorizontal className={isBar ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
        </button>

        {optionsOpen && (
          <div
            className={cn(
              'absolute right-0 z-40 w-56 space-y-3 rounded-2xl border border-white/15 bg-[#151820]/95 p-3 shadow-[0_20px_50px_rgba(0,0,0,0.8)] backdrop-blur-2xl',
              isBar ? 'top-10' : 'top-12'
            )}
          >
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-white/70">
                <span>Volume</span>
                <button
                  type="button"
                  aria-label={muted ? 'Unmute audio' : 'Mute audio'}
                  onClick={onToggleMute}
                  className="text-white/80 hover:text-white"
                >
                  {muted || volume === 0 ? (
                    <VolumeX className="h-4 w-4" />
                  ) : (
                    <Volume2 className="h-4 w-4" />
                  )}
                </button>
              </div>
              <input
                type="range"
                aria-label="Audio volume"
                min={0}
                max={1}
                step={0.01}
                value={muted ? 0 : volume}
                onChange={(event) => onVolumeChange(parseFloat(event.target.value))}
                className="h-1.5 w-full cursor-pointer rounded-full bg-white/20 accent-white"
              />
            </div>

            <button
              type="button"
              onClick={() => {
                onOpenQueue();
                setOptionsOpen(false);
              }}
              className="flex w-full items-center justify-between rounded-xl px-2.5 py-2 text-xs text-white/90 hover:bg-white/10"
            >
              <span className="flex items-center gap-2">
                <ListMusic className="h-3.5 w-3.5" />
                View Queue
              </span>
              <span className="font-mono-tabular text-white/60">{queueCount}</span>
            </button>

            {playlists.length > 0 && (
              <div className="space-y-1 border-t border-white/10 pt-2">
                <p className="px-2 text-[10px] font-medium text-white/45">Save to playlist</p>
                {playlists.map((playlist) => (
                  <button
                    key={playlist.id}
                    type="button"
                    onClick={() => {
                      onAddToPlaylist(playlist.id, track.id);
                      setOptionsOpen(false);
                    }}
                    className="w-full truncate rounded-xl px-2.5 py-1.5 text-left text-xs text-white/85 hover:bg-white/10"
                  >
                    + {playlist.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );

  return (
    <aside
      aria-label="Now playing"
      className={cn(
        'relative w-full border border-white/[0.12] shadow-[0_24px_65px_rgba(0,0,0,0.6)]',
        isBar
          ? 'h-[184px] overflow-visible rounded-[24px] md:h-[196px] lg:h-[212px]'
          : 'notched-hero-mask flex min-h-[440px] flex-col justify-between overflow-hidden rounded-[28px] lg:h-full lg:min-h-[540px]'
      )}
    >
      {/* Full-bleed artwork */}
      <div className="absolute inset-0 overflow-hidden rounded-[inherit]">
        <CoverImage
          src={track.coverSrc}
          alt={`${track.title} by ${track.artist}`}
          className={cn(
            'absolute object-cover transition-all duration-700',
            isBar
              ? 'inset-y-0 left-0 h-full w-[132px] md:w-[196px] lg:w-[212px]'
              : 'inset-0 h-full w-full'
          )}
        />

        {/* Measured contrast scrim */}
        <div
          className={cn(
            'absolute inset-0',
            isBar
              ? 'bg-gradient-to-r from-black/15 via-black/70 to-black/85'
              : 'bg-gradient-to-t from-black/85 via-black/25 to-black/15'
          )}
        />
      </div>

      {!isBar && (
        <div className="relative z-20 flex items-center justify-end gap-2.5 p-4 sm:p-5">
          {actionControls}
        </div>
      )}

      {isBar ? (
        <div className="relative z-10 flex h-full items-center pl-[148px] pr-4 md:pl-[212px] lg:pl-[228px] lg:pr-5">
          <div className="flex min-w-0 flex-1 flex-col justify-center gap-1 md:flex-row md:items-center md:gap-5">
            <div className="min-w-0 md:flex-1">
              <TrackMeta track={track} quality={quality} compact />
              <div className="mt-1 flex items-center gap-2">{actionControls}</div>
            </div>

            <div className="min-w-0 md:w-[46%] md:max-w-[440px] md:shrink-0">
              <div className="hidden h-5 overflow-hidden rounded bg-black/10 md:block">
                <Visualizer read={readAnalyser} active={isPlaying} bars={24} />
              </div>
              <SeekBar
                currentTime={currentTime}
                safeDuration={safeDuration}
                compact
                onSeek={onSeek}
              />
              <TransportControls
                compact
                isPlaying={isPlaying}
                shuffle={shuffle}
                repeat={repeat}
                onTogglePlay={onTogglePlay}
                onPrev={onPrev}
                onNext={onNext}
                onToggleShuffle={onToggleShuffle}
                onCycleRepeat={onCycleRepeat}
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="relative z-10 px-5 pb-6 pt-16 sm:px-6">
          <TrackMeta track={track} quality={quality} compact={false} />

          {/* Analyser-driven visualizer; idles while paused */}
          <div className="mt-3 h-7 overflow-hidden rounded-lg bg-black/10">
            <Visualizer read={readAnalyser} active={isPlaying} bars={30} />
          </div>

          <SeekBar
            currentTime={currentTime}
            safeDuration={safeDuration}
            compact={false}
            onSeek={onSeek}
          />
          <TransportControls
            compact={false}
            isPlaying={isPlaying}
            shuffle={shuffle}
            repeat={repeat}
            onTogglePlay={onTogglePlay}
            onPrev={onPrev}
            onNext={onNext}
            onToggleShuffle={onToggleShuffle}
            onCycleRepeat={onCycleRepeat}
          />
        </div>
      )}
    </aside>
  );
}
