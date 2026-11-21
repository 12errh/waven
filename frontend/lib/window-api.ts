'use client';

import { Events } from '@wailsio/runtime';
import * as Window from '@/bindings/waven/internal/desktop/windowservice';

/**
 * The window surface the compact player needs. The Wails implementation resizes
 * the native window; the browser preview only flips the layout flag so the mini
 * player can still be reviewed with `next dev`.
 */
export interface WindowApi {
  /** True only for the browser preview, never for the desktop shell. */
  preview: boolean;
  showMini(): Promise<void>;
  showFull(): Promise<void>;
  toggleMini(): Promise<void>;
  isMini(): Promise<boolean>;
  setAlwaysOnTop(onTop: boolean): Promise<void>;
  /** Fires wherever the switch came from: tray, header button, or shortcut. */
  onMiniChange(listener: (mini: boolean) => void): () => void;
}

function createDesktopApi(): WindowApi {
  return {
    preview: false,
    showMini: () => Window.ShowMini(),
    showFull: () => Window.ShowFull(),
    toggleMini: () => Window.ToggleMini(),
    isMini: () => Window.IsMini(),
    setAlwaysOnTop: (onTop) => Window.SetAlwaysOnTop(onTop),
    onMiniChange: (listener) =>
      Events.On('window:mini', (event) => {
        const payload = event.data as { mini?: boolean } | null;
        listener(Boolean(payload?.mini));
      }),
  };
}

// The browser preview keeps the flag in memory for the life of the page. There
// is no native window to resize, so this only exercises the compact layout.
const previewListeners = new Set<(mini: boolean) => void>();
let previewMini = false;

function setPreviewMini(mini: boolean): void {
  previewMini = mini;
  previewListeners.forEach((listener) => listener(mini));
}

function createPreviewApi(): WindowApi {
  return {
    preview: true,
    async showMini() {
      setPreviewMini(true);
    },
    async showFull() {
      setPreviewMini(false);
    },
    async toggleMini() {
      setPreviewMini(!previewMini);
    },
    async isMini() {
      return previewMini;
    },
    async setAlwaysOnTop() {
      // The browser has no window to pin.
    },
    onMiniChange(listener) {
      previewListeners.add(listener);
      return () => {
        previewListeners.delete(listener);
      };
    },
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('window runtime did not respond')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

let apiPromise: Promise<WindowApi> | null = null;

/**
 * Resolves the window API once per page. `Info` exists in every shell build, so
 * it is the cheap probe that decides between the native window and the preview.
 */
export function getWindowApi(): Promise<WindowApi> {
  apiPromise ??= detectWindow();
  return apiPromise;
}

async function detectWindow(): Promise<WindowApi> {
  if (typeof window === 'undefined') return createPreviewApi();
  try {
    await withTimeout(Promise.resolve().then(() => Window.Info()), 1500);
    return createDesktopApi();
  } catch {
    return createPreviewApi();
  }
}
