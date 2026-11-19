'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_SETTINGS,
  getSettingsApi,
  type AppInfo,
  type AppSettings,
  type SettingsApi,
} from './settings-api';
import {
  readWindowModeStorage,
  setWindowMode as cacheWindowMode,
} from './window-mode';

const WINDOW_MODE_MIGRATION_KEY = 'waven_window_mode_migrated_v1';

export interface SettingsController {
  ready: boolean;
  /** True when the browser fixture stands in for the Wails bridge. */
  preview: boolean;
  settings: AppSettings;
  info: AppInfo | null;
  error: string | null;
  saving: boolean;
  clearError: () => void;
  update: (patch: Partial<AppSettings>) => Promise<void>;
  refresh: () => Promise<void>;
  quit: () => Promise<void>;
}

function settingsErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return 'Could not save desktop settings.';
}

/**
 * The window mode used to live entirely in localStorage. On the first launch
 * after the move to SQLite, copy that choice into the settings service so an
 * existing Solid or Pure preference is not reset to the platform default.
 */
async function migrateWindowMode(api: SettingsApi, loaded: AppSettings): Promise<AppSettings> {
  if (typeof window === 'undefined') return loaded;
  try {
    if (window.localStorage.getItem(WINDOW_MODE_MIGRATION_KEY)) return loaded;
    const stored = readWindowModeStorage();
    if (stored && stored !== loaded.windowMode) {
      const migrated = await api.update({ ...loaded, windowMode: stored });
      window.localStorage.setItem(WINDOW_MODE_MIGRATION_KEY, '1');
      return migrated;
    }
    window.localStorage.setItem(WINDOW_MODE_MIGRATION_KEY, '1');
  } catch {
    // Retry on the next launch; localStorage remains the CSS fallback.
  }
  return loaded;
}

/**
 * Owns the desktop preferences. Updates are applied optimistically so the
 * appearance and toggles react immediately, then written to SQLite in order so
 * two quick clicks cannot finish out of order.
 */
export function useSettings(): SettingsController {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [ready, setReady] = useState(false);
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const settingsRef = useRef<AppSettings>(DEFAULT_SETTINGS);
  const mountedRef = useRef(true);
  const writeChainRef = useRef<Promise<void>>(Promise.resolve());

  const apply = useCallback((next: AppSettings) => {
    settingsRef.current = next;
    if (!mountedRef.current) return;
    setSettings(next);
    cacheWindowMode(next.windowMode);
  }, []);

  const load = useCallback(async () => {
    try {
      const api = await getSettingsApi();
      const loaded = await api.get();
      let next = loaded;
      if (!api.preview) {
        next = await migrateWindowMode(api, loaded);
      }
      const infoResult = await api.info().catch(() => null);
      if (!mountedRef.current) return;
      setPreview(api.preview);
      setInfo(infoResult);
      apply(next);
      setError(null);
    } catch (loadError) {
      if (mountedRef.current) setError(settingsErrorMessage(loadError));
    } finally {
      if (mountedRef.current) setReady(true);
    }
  }, [apply]);

  useEffect(() => {
    mountedRef.current = true;
    // Defer the first read so React commits the initial frame before the
    // promise callback updates settings (and avoids a cascading render).
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => {
      window.clearTimeout(timer);
      mountedRef.current = false;
    };
  }, [load]);

  const update = useCallback(
    (patch: Partial<AppSettings>) => {
      apply({ ...settingsRef.current, ...patch });

      const run = async () => {
        if (mountedRef.current) setSaving(true);
        try {
          const api = await getSettingsApi();
          const saved = await api.update(settingsRef.current);
          if (mountedRef.current) {
            apply(saved);
            setError(null);
          }
        } catch (saveError) {
          // The service rolls back a failed autostart write, so reload the
          // durable values instead of leaving the toggle optimistic.
          try {
            const current = await getSettingsApi();
            const restored = await current.get();
            if (mountedRef.current) apply(restored);
          } catch {
            // Keep the optimistic values; the error banner explains why.
          }
          if (mountedRef.current) setError(settingsErrorMessage(saveError));
        } finally {
          if (mountedRef.current) setSaving(false);
        }
      };

      writeChainRef.current = writeChainRef.current.then(run, run);
      return writeChainRef.current;
    },
    [apply]
  );

  const refresh = useCallback(async () => {
    await load();
  }, [load]);

  const clearError = useCallback(() => setError(null), []);

  const quit = useCallback(async () => {
    const api = await getSettingsApi();
    await api.quit();
  }, []);

  return {
    ready,
    preview,
    settings,
    info,
    error,
    saving,
    clearError,
    update,
    refresh,
    quit,
  };
}
