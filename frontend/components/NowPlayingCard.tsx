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
}: NowPlayingCardProps) {
  const [optionsOpen, setOptionsOpen] = useState(false);

  if (!track) {
    return (
      <aside
        aria-label="Now playing"
        className="relative w-full min-h-[440px] lg:h-full lg:min-h-[540px] rounded-[28px] overflow-hidden notched-hero-mask shadow-[0_24px_65px_rgba(0,0,0,0.6)] border border-white/[0.12] flex flex-col items-center justify-center gap-4 bg-gradient-to-br from-slate-800 via-zinc-900 to-black p-8 text-center"
      >
        <div className="w-24 h-24 rounded-3xl bg-white/[0.06] border border-white/10 flex items-center justify-center">
          <Disc3 className="w-10 h-10 text-white/35" />
        </div>
        <div className="space-y-1.5 max-w-[260px]">
          <h2 className="font-display text-lg font-semibold text-white">Nothing playing yet</h2>
          <p className="text-sm text-white/55 leading-relaxed">
            Add a music folder and WAVEN will scan your files, artwork, and tags.
          </p>
        </div>
        <button
          type="button"
          onClick={onOpenLibrary}
          className="px-5 py-2.5 rounded-full bg-white text-[#090b10] text-xs font-semibold hover:bg-white/90 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
        >
          Add music folder
        </button>
      </aside>
    );
  }

  const safeDuration = duration > 0 ? duration : track.durationSec;
  const progressPct = safeDuration > 0 ? Math.min(100, (currentTime / safeDuration) * 100) : 0;
  const quality = formatTrackQuality(track);

  const handleSeekClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    onSeek(computeSeekTime(ratio, safeDuration));
  };

  return (
    <aside
      aria-label="Now playing"
      className="relative w-full min-h-[440px] lg:h-full lg:min-h-[540px] rounded-[28px] overflow-hidden notched-hero-mask shadow-[0_24px_65px_rgba(0,0,0,0.6)] border border-white/[0.12] flex flex-col justify-between"
    >
      {/* Full-bleed artwork */}
      <CoverImage
        src={track.coverSrc}
        alt={`${track.title} by ${track.artist}`}
        className="absolute inset-0 w-full h-full object-cover transition-all duration-700"
      />

      {/* Measured contrast scrim */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-black/15" />

      {/* Top-right floating glass controls */}
      <div className="relative z-20 flex items-center justify-end gap-2.5 p-4 sm:p-5">
        <button
          type="button"
          aria-label={isLiked ? `Unlike ${track.title}` : `Like ${track.title}`}
          onClick={() => onToggleLike(track.id)}
          className={cn(
            'w-10 h-10 rounded-full flex items-center justify-center backdrop-blur-xl border transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60',
            isLiked
              ? 'bg-white/25 border-white/45 text-white'
              : 'bg-black/25 border-white/25 text-white/85 hover:text-white hover:bg-white/20'
          )}
        >
          <Heart className={cn('w-4 h-4', isLiked && 'fill-white')} />
        </button>

        <div className="relative">
          <button
            type="button"
            aria-label="Player and queue options"
            aria-expanded={optionsOpen}
            onClick={() => setOptionsOpen(!optionsOpen)}
            className="w-10 h-10 rounded-full bg-black/25 backdrop-blur-xl border border-white/25 text-white/85 hover:text-white hover:bg-white/20 flex items-center justify-center transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>

          {optionsOpen && (
            <div className="absolute right-0 top-12 z-40 w-56 rounded-2xl bg-[#151820]/95 backdrop-blur-2xl border border-white/15 p-3 shadow-[0_20px_50px_rgba(0,0,0,0.8)] space-y-3">
              {/* Volume Slider */}
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
                      <VolumeX className="w-4 h-4" />
                    ) : (
                      <Volume2 className="w-4 h-4" />
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
                  onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
                  className="w-full accent-white h-1.5 bg-white/20 rounded-full cursor-pointer"
                />
              </div>

              <button
                type="button"
                onClick={() => {
                  onOpenQueue();
                  setOptionsOpen(false);
                }}
                className="w-full flex items-center justify-between px-2.5 py-2 rounded-xl text-xs text-white/90 hover:bg-white/10"
              >
                <span className="flex items-center gap-2">
                  <ListMusic className="w-3.5 h-3.5" />
                  View Queue
                </span>
                <span className="font-mono-tabular text-white/60">{queueCount}</span>
              </button>

              {playlists.length > 0 && (
                <div className="border-t border-white/10 pt-2 space-y-1">
                  <p className="px-2 text-[10px] font-medium text-white/45">Save to playlist</p>
                  {playlists.map((pl) => (
                    <button
                      key={pl.id}
                      type="button"
                      onClick={() => {
                        onAddToPlaylist(pl.id, track.id);
                        setOptionsOpen(false);
                      }}
                      className="w-full text-left px-2.5 py-1.5 rounded-xl text-xs text-white/85 hover:bg-white/10 truncate"
                    >
                      + {pl.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Bottom Now Playing Metadata + Scrubber + Transport Controls */}
      <div className="relative z-10 px-5 sm:px-6 pb-6 pt-16">
        <span className="inline-block max-w-full truncate px-3 py-0.5 rounded-full bg-white/15 backdrop-blur-md border border-white/15 text-[10px] font-medium text-white/90">
          {track.genre || 'Local file'}
        </span>

        <h2 className="font-display text-2xl sm:text-[30px] font-bold uppercase tracking-wide text-white leading-tight mt-2.5 truncate">
          {track.title}
        </h2>

        <div className="flex items-center justify-between gap-3 mt-1">
          <p className="text-xs sm:text-sm text-white/80 truncate">{track.artist}</p>
          <span
            className="text-[10px] font-mono-tabular text-white/65 shrink-0 truncate max-w-[45%] text-right"
            title={quality}
          >
            {quality}
          </span>
        </div>

        {/* Analyser-driven visualizer; idles while paused */}
        <div className="mt-3 h-7 overflow-hidden rounded-lg bg-black/10">
          <Visualizer read={readAnalyser} active={isPlaying} bars={30} />
        </div>

        {/* Interactive Progress Bar */}
        <div className="mt-3">
          <div
            role="slider"
            tabIndex={0}
            aria-label="Seek track progress"
            aria-valuemin={0}
            aria-valuemax={Math.round(safeDuration)}
            aria-valuenow={Math.round(currentTime)}
            onClick={handleSeekClick}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight') onSeek(Math.min(safeDuration, currentTime + 5));
              if (e.key === 'ArrowLeft') onSeek(Math.max(0, currentTime - 5));
            }}
            className="group relative h-2 flex items-center cursor-pointer focus-visible:outline-none"
          >
            <div className="w-full h-1 rounded-full bg-white/25 overflow-hidden">
              <div
                className="h-full bg-white rounded-full transition-[width] duration-100"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <div
              className="absolute w-3 h-3 rounded-full bg-white shadow-md -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ left: `${progressPct}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-[11px] font-mono-tabular text-white/75 mt-1">
            <span>{formatTimeMMSS(currentTime)}</span>
            <span>{formatTimeMMSS(safeDuration)}</span>
          </div>
        </div>

        {/* Transport Controls */}
        <div className="mt-4 flex items-center justify-center gap-4 sm:gap-6">
          <button
            type="button"
            aria-label={shuffle ? 'Disable shuffle' : 'Enable shuffle'}
            aria-pressed={shuffle}
            onClick={onToggleShuffle}
            className={cn(
              'w-10 h-10 rounded-full flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60',
              shuffle ? 'text-white bg-white/15' : 'text-white/65 hover:text-white'
            )}
          >
            <Shuffle className="w-4 h-4" />
          </button>

          <button
            type="button"
            aria-label="Previous track"
            onClick={onPrev}
            className="w-10 h-10 rounded-full flex items-center justify-center text-white/90 hover:text-white hover:bg-white/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          >
            <SkipBack className="w-5 h-5 fill-current" />
          </button>

          <button
            type="button"
            aria-label={isPlaying ? 'Pause playback' : 'Start playback'}
            onClick={onTogglePlay}
            className="w-12 h-12 rounded-full bg-white text-[#090b10] flex items-center justify-center shadow-[0_8px_24px_rgba(255,255,255,0.28)] hover:scale-105 active:scale-95 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            {isPlaying ? (
              <Pause className="w-5 h-5 fill-current" />
            ) : (
              <Play className="w-5 h-5 fill-current ml-0.5" />
            )}
          </button>

          <button
            type="button"
            aria-label="Next track"
            onClick={onNext}
            className="w-10 h-10 rounded-full flex items-center justify-center text-white/90 hover:text-white hover:bg-white/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          >
            <SkipForward className="w-5 h-5 fill-current" />
          </button>

          <button
            type="button"
            aria-label={`Repeat mode: ${repeat}`}
            onClick={onCycleRepeat}
            className={cn(
              'w-10 h-10 rounded-full flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60',
              repeat !== 'off' ? 'text-white bg-white/15' : 'text-white/65 hover:text-white'
            )}
          >
            {repeat === 'one' ? (
              <Repeat1 className="w-4 h-4" />
            ) : (
              <Repeat className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>
    </aside>
  );
}
