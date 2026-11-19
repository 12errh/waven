'use client';

import * as SettingsBindings from '@/bindings/waven/internal/desktop/settingsservice';
import * as WindowBindings from '@/bindings/waven/internal/desktop/windowservice';
import {
  DEFAULT_WINDOW_MODE,
  isWindowMode,
  type WindowMode,
} from './window-mode';

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
};

const PREVIEW_INFO: AppInfo = {
  version: '0.1.0',
  platform: 'web',
  dataDir: 'Browser preview',
  cacheDir: 'Browser preview',
  trayAvailable: false,
  autostartSupported: false,
};

type RawSettings = Partial<Omit<AppSettings, 'windowMode'>> & { windowMode?: string };

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

function createPreviewApi(): SettingsApi {
  let stored: AppSettings = { ...DEFAULT_SETTINGS };
  return {
    preview: true,
    get: async () => ({ ...stored }),
    update: async (next) => {
      stored = normalizeSettings(next);
      return { ...stored };
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
