'use client';

import * as SettingsBindings from '@/bindings/waven/internal/desktop/settingsservice';
import * as WindowBindings from '@/bindings/waven/internal/desktop/windowservice';
import {
  DEFAULT_WINDOW_MODE,
  isWindowMode,
  type WindowMode,
} from './window-mode';
import {
  DEFAULT_LAYOUT,
  normalizeLayout,
  type LayoutSettings,
  type RawLayoutSettings,
} from './layout';

/**
 * The settings surface shared by the Wails bindings and the browser preview.
 * Values mirror the Go `AppSettings` model, with `windowMode` narrowed to the
 * three modes the CSS layer understands.
 */
export interface AppSettings {
  windowMode: WindowMode;
  closeToTray: boolean;
  startHidden: boolean;
  autostart: boolean;
  alwaysOnTopMini: boolean;
  layout: LayoutSettings;
}

/** Read-only shell information for the About section. */
export interface AppInfo {
  version: string;
  platform: string;
  dataDir: string;
  cacheDir: string;
  trayAvailable: boolean;
  autostartSupported: boolean;
}

export interface SettingsApi {
  /** True only for the browser fixture, never for the desktop shell. */
  preview: boolean;
  get(): Promise<AppSettings>;
  update(next: AppSettings): Promise<AppSettings>;
  info(): Promise<AppInfo>;
  quit(): Promise<void>;
}

export const DEFAULT_SETTINGS: AppSettings = {
  windowMode: DEFAULT_WINDOW_MODE,
  closeToTray: true,
  startHidden: false,
  autostart: false,
  alwaysOnTopMini: true,
  layout: DEFAULT_LAYOUT,
};

const PREVIEW_INFO: AppInfo = {
  version: '0.1.0',
  platform: 'web',
  dataDir: 'Browser preview',
  cacheDir: 'Browser preview',
  trayAvailable: false,
  autostartSupported: false,
};

type RawSettings = Partial<Omit<AppSettings, 'windowMode' | 'layout'>> & {
  windowMode?: string;
  layout?: RawLayoutSettings;
};

function normalizeSettings(raw: RawSettings | null | undefined): AppSettings {
  const mode = typeof raw?.windowMode === 'string' && isWindowMode(raw.windowMode)
    ? raw.windowMode
    : DEFAULT_SETTINGS.windowMode;
  return {
    windowMode: mode,
    closeToTray: raw?.closeToTray ?? DEFAULT_SETTINGS.closeToTray,
    startHidden: raw?.startHidden ?? DEFAULT_SETTINGS.startHidden,
    autostart: raw?.autostart ?? DEFAULT_SETTINGS.autostart,
    alwaysOnTopMini: raw?.alwaysOnTopMini ?? DEFAULT_SETTINGS.alwaysOnTopMini,
    layout: normalizeLayout(raw?.layout),
  };
}

function createDesktopApi(): SettingsApi {
  return {
    preview: false,
    get: () => SettingsBindings.Get().then((value) => normalizeSettings(value)),
    update: (next) =>
      SettingsBindings.Update(next).then((value) => normalizeSettings(value)),
    info: () => WindowBindings.Info(),
    quit: () => WindowBindings.Quit(),
  };
}

const PREVIEW_SETTINGS_KEY = 'waven_preview_settings_v1';

function readPreviewSettings(): AppSettings {
  if (typeof window === 'undefined') return { ...DEFAULT_SETTINGS };
  try {
    const raw = window.localStorage.getItem(PREVIEW_SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return normalizeSettings(JSON.parse(raw) as RawSettings);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function createPreviewApi(): SettingsApi {
  let stored = readPreviewSettings();
  return {
    preview: true,
    get: async () => ({ ...stored, layout: { ...stored.layout } }),
    update: async (next) => {
      stored = normalizeSettings(next);
      // Persist preview preferences (including the customised layout) so a
      // browser refresh behaves like a desktop restart.
      try {
        window.localStorage.setItem(PREVIEW_SETTINGS_KEY, JSON.stringify(stored));
      } catch {
        // Private browsing can reject writes; the in-memory copy still works.
      }
      return { ...stored, layout: { ...stored.layout } };
    },
    info: async () => ({ ...PREVIEW_INFO }),
    quit: async () => {},
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('desktop runtime did not respond')), ms);
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

let apiPromise: Promise<SettingsApi> | null = null;

/**
 * Resolves the desktop settings once per page. A plain browser preview falls
 * back to an in-memory implementation so the Settings screen stays usable
 * without the Wails bridge.
 */
export function getSettingsApi(): Promise<SettingsApi> {
  apiPromise ??= detectSettings();
  return apiPromise;
}

async function detectSettings(): Promise<SettingsApi> {
  if (typeof window === 'undefined') return createPreviewApi();
  try {
    await withTimeout(SettingsBindings.Get(), 3000);
    return createDesktopApi();
  } catch {
    return createPreviewApi();
  }
}
