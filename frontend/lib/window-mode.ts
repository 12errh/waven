export type WindowMode = 'glass' | 'pure' | 'solid';

export const DEFAULT_WINDOW_MODE: WindowMode = 'glass';
export const WINDOW_MODE_STORAGE_KEY = 'waven_window_mode_v1';

export const WINDOW_MODE_SWATCHES: Record<WindowMode, string> = {
  glass:
    'border-white/40 bg-[linear-gradient(135deg,rgba(255,255,255,0.58),rgba(255,255,255,0.06))]',
  pure: 'border-white/60 bg-transparent',
  solid: 'border-white/25 bg-[#07080b]',
};

export const WINDOW_MODES: Array<{
  id: WindowMode;
  label: string;
  hint: string;
}> = [
  {
    id: 'glass',
    label: 'Glass',
    hint: 'Glass with ambient tint from the current cover',
  },
  {
    id: 'pure',
    label: 'Pure glass',
    hint: 'Pure glass — the desktop shows through',
  },
  {
    id: 'solid',
    label: 'Solid',
    hint: 'Solid background fallback',
  },
];

export function isWindowMode(value: string | null): value is WindowMode {
  return value === 'glass' || value === 'pure' || value === 'solid';
}

// The window appearance lives outside React so it can be read during the first
// client render without an effect (and without a hydration mismatch). The
// server snapshot is always the default; the stored value is picked up as soon
// as React subscribes.
const listeners = new Set<() => void>();

export function readStoredWindowMode(): WindowMode {
  return readWindowModeStorage() ?? DEFAULT_WINDOW_MODE;
}

/** Returns the stored mode, or null when the user has never chosen one. */
export function readWindowModeStorage(): WindowMode | null {
  try {
    const saved = window.localStorage.getItem(WINDOW_MODE_STORAGE_KEY);
    return isWindowMode(saved) ? saved : null;
  } catch {
    return null;
  }
}

export function getWindowModeSnapshot(): WindowMode {
  if (typeof window === 'undefined') return DEFAULT_WINDOW_MODE;
  return readStoredWindowMode();
}

export function subscribeWindowMode(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {};

  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === WINDOW_MODE_STORAGE_KEY || event.key === null) {
      listener();
    }
  };
  window.addEventListener('storage', onStorage);

  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function setWindowMode(mode: WindowMode): void {
  try {
    window.localStorage.setItem(WINDOW_MODE_STORAGE_KEY, mode);
  } catch {
    // Storage may be unavailable; the in-memory store still updates.
  }
  listeners.forEach((listener) => listener());
}
