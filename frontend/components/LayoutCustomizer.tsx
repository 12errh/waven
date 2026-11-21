'use client';

import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { Check, GripVertical, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  DOCK_POSITIONS,
  HERO_POSITIONS,
  LAYOUT_SPLIT_MAX,
  LAYOUT_SPLIT_MIN,
  NAV_POSITIONS,
  type DockPosition,
  type HeroPosition,
  type LayoutPart,
  type LayoutSettings,
  type NavPosition,
} from '@/lib/layout';

interface DragHandleProps {
  part: LayoutPart;
  label: string;
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  className?: string;
}

/** Grab pill shown on each movable panel while the layout editor is open. */
export function LayoutDragHandle({
  part,
  label,
  onPointerDown,
  className,
}: DragHandleProps) {
  return (
    <button
      type="button"
      data-layout-handle={part}
      aria-label={`Move ${label}`}
      title={`Drag to move ${label.toLowerCase()}`}
      onPointerDown={onPointerDown}
      className={cn(
        'wails-no-drag touch-none select-none inline-flex cursor-grab items-center gap-1.5 rounded-full border border-white/25 bg-[#11141c]/95 px-2.5 py-1 text-[10px] font-medium text-white shadow-[0_10px_30px_rgba(0,0,0,0.6)] active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60',
        className
      )}
    >
      <GripVertical className="h-3 w-3 text-white/60" />
      {label}
    </button>
  );
}

interface DropZone {
  id: string;
  label: string;
  className: string;
}

const DROP_ZONES: Record<LayoutPart, DropZone[]> = {
  dock: [
    { id: 'dock:left', label: 'Dock left', className: 'left-4 top-28 bottom-28 w-28' },
    { id: 'dock:right', label: 'Dock right', className: 'right-4 top-28 bottom-28 w-28' },
    {
      id: 'dock:bottom',
      label: 'Dock bottom',
      className: 'bottom-24 left-1/2 h-20 w-64 -translate-x-1/2',
    },
  ],
  nav: [
    {
      id: 'nav:top',
      label: 'Tabs on top',
      className: 'top-4 left-1/2 h-20 w-72 -translate-x-1/2',
    },
    {
      id: 'nav:bottom',
      label: 'Tabs at bottom',
      className: 'bottom-24 left-1/2 h-20 w-72 -translate-x-1/2',
    },
    {
      id: 'nav:hidden',
      label: 'Hide tabs',
      className: 'top-1/2 left-1/2 h-20 w-56 -translate-x-1/2 -translate-y-1/2',
    },
  ],
  hero: [
    { id: 'hero:left', label: 'Player left', className: 'left-4 top-28 bottom-28 w-32' },
    { id: 'hero:right', label: 'Player right', className: 'right-4 top-28 bottom-28 w-32' },
    {
      id: 'hero:bottom',
      label: 'Player below',
      className: 'bottom-24 left-1/2 h-24 w-72 -translate-x-1/2',
    },
    {
      id: 'hero:hidden',
      label: 'Hide player',
      className: 'top-1/2 left-1/2 h-20 w-56 -translate-x-1/2 -translate-y-1/2',
    },
  ],
};

interface DropZonesProps {
  part: LayoutPart;
  hovered: string | null;
  onHover: (zone: string | null) => void;
}

/** Edge targets displayed while a panel is being dragged. */
export function LayoutDropZones({ part, hovered, onHover }: DropZonesProps) {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-[85]">
      {DROP_ZONES[part].map((zone) => (
        <div
          key={zone.id}
          data-layout-zone={zone.id}
          onPointerEnter={() => onHover(zone.id)}
          onPointerLeave={() => onHover(null)}
          className={cn(
            'pointer-events-auto absolute flex items-center justify-center rounded-3xl border-2 border-dashed text-center transition-colors',
            hovered === zone.id
              ? 'border-white/80 bg-white/20 text-white'
              : 'border-white/35 bg-[#0b0e15]/55 text-white/75',
            zone.className
          )}
        >
          <span className="rounded-full bg-black/45 px-3 py-1.5 text-[11px] font-medium backdrop-blur-sm">
            {zone.label}
          </span>
        </div>
      ))}
      <div className="absolute left-1/2 top-6 -translate-x-1/2 rounded-full border border-white/20 bg-[#11141c]/95 px-4 py-2 text-[11px] text-white/75 shadow-[0_12px_40px_rgba(0,0,0,0.6)]">
        Drop on a highlighted target · Esc to cancel
      </div>
    </div>
  );
}

interface SegmentedProps<T extends string> {
  label: string;
  value: T;
  options: Array<{ id: T; label: string }>;
  onChange: (value: T) => void;
}

function Segmented<T extends string>({ label, value, options, onChange }: SegmentedProps<T>) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        'grid gap-1 rounded-xl bg-black/30 p-1',
        options.length === 4 ? 'grid-cols-4' : 'grid-cols-3'
      )}
    >
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={value === option.id}
          onClick={() => onChange(option.id)}
          className={cn(
            'rounded-lg px-1 py-1.5 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50',
            value === option.id
              ? 'bg-white text-[#0a0c12]'
              : 'text-white/60 hover:bg-white/10 hover:text-white'
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/40">
        {title}
      </p>
      {children}
    </div>
  );
}

interface ToolbarProps {
  layout: LayoutSettings;
  split: number;
  onLayoutChange: (patch: Partial<LayoutSettings>) => void;
  onSplitChange: (value: number) => void;
  onSplitCommit: () => void;
  onReset: () => void;
  onDone: () => void;
}

/** Floating control panel for the layout editor. */
export function LayoutToolbar({
  layout,
  split,
  onLayoutChange,
  onSplitChange,
  onSplitCommit,
  onReset,
  onDone,
}: ToolbarProps) {
  const sideBySide = layout.heroPosition === 'left' || layout.heroPosition === 'right';

  return (
    <div
      role="dialog"
      aria-label="Customize layout"
      className="waven-scroll fixed inset-x-3 bottom-20 z-[90] max-h-[52vh] space-y-3 overflow-y-auto rounded-3xl border border-white/15 bg-[#10131b]/95 p-4 shadow-[0_28px_80px_rgba(0,0,0,0.8)] backdrop-blur-2xl lg:inset-x-auto lg:bottom-5 lg:right-5 lg:max-h-[calc(100dvh-10rem)] lg:w-[300px]"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-display text-sm font-semibold text-white">Customize layout</p>
          <p className="text-[10px] leading-snug text-white/45">
            Drag a panel by its handle, or use these controls.
          </p>
        </div>
        <button
          type="button"
          aria-label="Finish customizing"
          title="Finish customizing"
          onClick={onDone}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-[#0a0c12] transition-colors hover:bg-white/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
        >
          <Check className="h-4 w-4" />
        </button>
      </div>

      <Section title="Side navigation">
        <Segmented
          label="Side navigation position"
          value={layout.dockPosition}
          options={DOCK_POSITIONS}
          onChange={(dockPosition: DockPosition) => onLayoutChange({ dockPosition })}
        />
        <button
          type="button"
          role="switch"
          aria-checked={layout.dockExpanded}
          onClick={() => onLayoutChange({ dockExpanded: !layout.dockExpanded })}
          className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-[11px] text-white/75 transition-colors hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
        >
          <span>Show labels</span>
          <span
            aria-hidden="true"
            className={cn(
              'flex h-4 w-7 items-center rounded-full p-0.5 transition-colors',
              layout.dockExpanded ? 'bg-white' : 'bg-white/20'
            )}
          >
            <span
              className={cn(
                'h-3 w-3 rounded-full bg-[#0a0c12] transition-transform',
                layout.dockExpanded && 'translate-x-3'
              )}
            />
          </span>
        </button>
      </Section>

      <Section title="Now playing">
        <Segmented
          label="Now playing position"
          value={layout.heroPosition}
          options={HERO_POSITIONS}
          onChange={(heroPosition: HeroPosition) => onLayoutChange({ heroPosition })}
        />
      </Section>

      <Section title="Category tabs">
        <Segmented
          label="Category tabs position"
          value={layout.navPosition}
          options={NAV_POSITIONS}
          onChange={(navPosition: NavPosition) => onLayoutChange({ navPosition })}
        />
      </Section>

      <Section title="Content width">
        <div className="flex items-center gap-3">
          <input
            type="range"
            aria-label="Content panel width"
            min={LAYOUT_SPLIT_MIN}
            max={LAYOUT_SPLIT_MAX}
            step={1}
            value={split}
            disabled={!sideBySide}
            onChange={(event) => onSplitChange(Number(event.target.value))}
            onPointerUp={onSplitCommit}
            onKeyUp={onSplitCommit}
            onBlur={onSplitCommit}
            className="h-1.5 w-full cursor-pointer accent-white disabled:cursor-not-allowed disabled:opacity-40"
          />
          <span className="w-9 shrink-0 text-right font-mono-tabular text-[11px] text-white/60">
            {split}%
          </span>
        </div>
        {!sideBySide && (
          <p className="text-[10px] leading-snug text-white/40">
            Place the player beside the content to resize the split.
          </p>
        )}
      </Section>

      <div className="flex items-center justify-between gap-2 border-t border-white/10 pt-3">
        <button
          type="button"
          onClick={onReset}
          className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] text-white/65 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
        >
          <RotateCcw className="h-3 w-3" />
          Reset
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-full bg-white px-4 py-1.5 text-[11px] font-semibold text-[#0a0c12] transition-colors hover:bg-white/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
        >
          Done
        </button>
      </div>
    </div>
  );
}
