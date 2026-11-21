/**
 * The shell arrangement the user can customise. Positions are deliberately a
 * small, validated set so drag-and-drop and the settings screen can only ever
 * produce a layout the shell knows how to render.
 */
export type DockPosition = 'left' | 'right' | 'bottom';
export type NavPosition = 'top' | 'bottom' | 'hidden';
export type HeroPosition = 'left' | 'right' | 'bottom' | 'hidden';
export type LayoutPart = 'dock' | 'nav' | 'hero';

export interface LayoutSettings {
  dockPosition: DockPosition;
  dockExpanded: boolean;
  navPosition: NavPosition;
  heroPosition: HeroPosition;
  /** Width of the content column when the now-playing card sits beside it. */
  split: number;
}

export const LAYOUT_SPLIT_MIN = 35;
export const LAYOUT_SPLIT_MAX = 75;

export const DEFAULT_LAYOUT: LayoutSettings = {
  dockPosition: 'left',
  dockExpanded: false,
  navPosition: 'top',
  heroPosition: 'right',
  split: 58,
};

export const DOCK_POSITIONS: Array<{ id: DockPosition; label: string }> = [
  { id: 'left', label: 'Left' },
  { id: 'right', label: 'Right' },
  { id: 'bottom', label: 'Bottom' },
];

export const NAV_POSITIONS: Array<{ id: NavPosition; label: string }> = [
  { id: 'top', label: 'Top' },
  { id: 'bottom', label: 'Bottom' },
  { id: 'hidden', label: 'Hidden' },
];

export const HERO_POSITIONS: Array<{ id: HeroPosition; label: string }> = [
  { id: 'left', label: 'Left' },
  { id: 'right', label: 'Right' },
  { id: 'bottom', label: 'Bottom' },
  { id: 'hidden', label: 'Hidden' },
];

export function clampSplit(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_LAYOUT.split;
  return Math.min(LAYOUT_SPLIT_MAX, Math.max(LAYOUT_SPLIT_MIN, Math.round(value)));
}

export interface RawLayoutSettings {
  dockPosition?: string;
  dockExpanded?: boolean;
  navPosition?: string;
  heroPosition?: string;
  split?: number;
}

/**
 * Fills missing or invalid fields from the defaults. The Go service performs
 * the same validation so a stale browser cache or an edited database row can
 * never wedge the shell.
 */
export function normalizeLayout(raw: RawLayoutSettings | null | undefined): LayoutSettings {
  const dockPosition = DOCK_POSITIONS.some((entry) => entry.id === raw?.dockPosition)
    ? (raw?.dockPosition as DockPosition)
    : DEFAULT_LAYOUT.dockPosition;
  const navPosition = NAV_POSITIONS.some((entry) => entry.id === raw?.navPosition)
    ? (raw?.navPosition as NavPosition)
    : DEFAULT_LAYOUT.navPosition;
  const heroPosition = HERO_POSITIONS.some((entry) => entry.id === raw?.heroPosition)
    ? (raw?.heroPosition as HeroPosition)
    : DEFAULT_LAYOUT.heroPosition;
  return {
    dockPosition,
    dockExpanded: raw?.dockExpanded ?? DEFAULT_LAYOUT.dockExpanded,
    navPosition,
    heroPosition,
    split: clampSplit(raw?.split ?? DEFAULT_LAYOUT.split),
  };
}
