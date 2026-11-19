'use client';

import { Minus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { runWindowAction } from '@/lib/desktop-runtime';
import { WINDOW_MODES, type WindowMode } from '@/lib/window-mode';

interface DesktopControlsProps {
  mode: WindowMode;
  onModeChange: (mode: WindowMode) => void;
}

const SWATCHES: Record<WindowMode, string> = {
  glass:
    'border-white/40 bg-[linear-gradient(135deg,rgba(255,255,255,0.58),rgba(255,255,255,0.06))]',
  pure: 'border-white/60 bg-transparent',
  solid: 'border-white/25 bg-[#07080b]',
};

export function DesktopControls({ mode, onModeChange }: DesktopControlsProps) {
  return (
    <div className="wails-no-drag flex items-center gap-1.5">
      <div
        role="group"
        aria-label="Window appearance"
        className="flex items-center gap-0.5 rounded-full border border-white/[0.08] bg-black/20 p-0.5 backdrop-blur-xl"
      >
        {WINDOW_MODES.map((option) => {
          const active = option.id === mode;
          return (
            <button
              key={option.id}
              type="button"
              title={option.hint}
              aria-label={option.hint}
              aria-pressed={active}
              onClick={() => onModeChange(option.id)}
              className={cn(
                'group flex h-5 w-5 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50',
                active ? 'bg-white/[0.12]' : 'hover:bg-white/[0.06]'
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'h-2 w-2 rounded-full border transition-transform duration-200',
                  SWATCHES[option.id],
                  active ? 'scale-110' : 'opacity-70 group-hover:opacity-100'
                )}
              />
            </button>
          );
        })}
      </div>

      <div aria-hidden="true" className="mx-0.5 h-4 w-px bg-white/10" />

      <button
        type="button"
        title="Minimise"
        aria-label="Minimise window"
        onClick={() => void runWindowAction('minimise')}
        className="flex h-7 w-7 items-center justify-center rounded-full text-white/50 transition-colors hover:bg-white/[0.10] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
      >
        <Minus className="h-3.5 w-3.5" strokeWidth={1.8} />
      </button>
      <button
        type="button"
        title="Close WAVEN"
        aria-label="Close WAVEN"
        onClick={() => void runWindowAction('close')}
        className="flex h-7 w-7 items-center justify-center rounded-full text-white/50 transition-colors hover:bg-red-500/80 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
      >
        <X className="h-3.5 w-3.5" strokeWidth={1.8} />
      </button>
    </div>
  );
}
