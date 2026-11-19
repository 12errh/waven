'use client';

import { Clock3, Heart, Repeat2, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { MixKind, Track } from '@/lib/types';
import { CoverImage } from './CoverImage';

interface DiscoverMixesProps {
  mixes: Record<MixKind, Track[]>;
  activeMix: MixKind;
  onSelect: (kind: MixKind) => void;
}

const MIX_DEFINITIONS: Array<{
  kind: MixKind;
  title: string;
  caption: string;
  icon: typeof Sparkles;
}> = [
  {
    kind: 'recently_added',
    title: 'Recently Added',
    caption: 'Fresh in your library',
    icon: Sparkles,
  },
  {
    kind: 'recently_played',
    title: 'Recently Played',
    caption: 'Back for another listen',
    icon: Clock3,
  },
  {
    kind: 'on_repeat',
    title: 'On Repeat',
    caption: 'Three plays in two weeks',
    icon: Repeat2,
  },
  {
    kind: 'favorites',
    title: 'Favorites',
    caption: 'Songs you liked',
    icon: Heart,
  },
];

/**
 * The Discover screen's four in-library mixes. Selecting a card swaps the
 * track list below without leaving the screen; playback always uses the whole
 * mix as its queue.
 */
export function DiscoverMixes({ mixes, activeMix, onSelect }: DiscoverMixesProps) {
  return (
    <section aria-label="Mixes from your library" className="w-full min-w-0">
      <div className="mb-2 flex items-end justify-between px-1">
        <h2 className="text-[10px] font-medium uppercase tracking-[0.18em] text-white/45">
          Mixes from your library
        </h2>
        <span className="text-[10px] text-white/35">Built as you listen</span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {MIX_DEFINITIONS.map(({ kind, title, caption, icon: Icon }) => {
          const mixTracks = mixes[kind] ?? [];
          const cover = mixTracks.find((track) => track.coverSrc)?.coverSrc ?? '';
          const selected = activeMix === kind;
          return (
            <button
              key={kind}
              type="button"
              aria-pressed={selected}
              onClick={() => onSelect(kind)}
              className={cn(
                'group relative h-[92px] overflow-hidden rounded-[20px] border p-3 text-left transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60',
                selected
                  ? 'border-white/40 bg-white/[0.14] shadow-[0_12px_30px_rgba(0,0,0,0.35)]'
                  : 'border-white/[0.1] bg-white/[0.05] hover:border-white/20 hover:bg-white/[0.09]'
              )}
            >
              {cover && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={cover}
                  alt=""
                  referrerPolicy="no-referrer"
                  className="pointer-events-none absolute inset-0 h-full w-full scale-125 object-cover opacity-15 blur-md transition-opacity duration-300 group-hover:opacity-25"
                />
              )}
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-black/10 via-black/25 to-black/55" />
              <div className="relative z-10 flex h-full flex-col justify-between">
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={cn(
                      'flex h-7 w-7 items-center justify-center rounded-full border backdrop-blur-md',
                      selected
                        ? 'border-white/40 bg-white/20 text-white'
                        : 'border-white/15 bg-white/10 text-white/70'
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <span className="font-mono-tabular text-[10px] text-white/50">
                    {mixTracks.length > 0 ? `${mixTracks.length} tracks` : 'empty'}
                  </span>
                </div>
                <div className="min-w-0">
                  <p className="truncate text-[12px] font-semibold text-white">{title}</p>
                  <p className="mt-0.5 truncate text-[10px] text-white/50">{caption}</p>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
