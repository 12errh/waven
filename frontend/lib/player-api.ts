'use client';

import { Events } from '@wailsio/runtime';
import * as Player from '@/bindings/waven/internal/desktop/playerservice';
import { normalizePlayerSession } from './player-logic';
import type { PlayerSession, PlayerState } from './types';

export type TrayCommand = 'playPause' | 'next' | 'prev';

/**
 * The player surface the interface talks to. The Wails implementation stores
 * sessions in SQLite and drives the tray; the browser preview keeps a local
 * session so the UI can still be exercised outside the desktop shell.
 */
export interface PlayerApi {
  preview: boolean;
  getSession(): Promise<PlayerSession>;
  saveSession(session: PlayerSession): Promise<void>;
  recordPlay(trackId: number, positionMs: number): Promise<void>;
  updateState(state: PlayerState): Promise<void>;
  onTrayCommand(listener: (command: TrayCommand) => void): () => void;
}

const PREVIEW_SESSION_KEY = 'waven_player_session_v1';

function createDesktopApi(): PlayerApi {
  return {
    preview: false,
    getSession: async () =>
      normalizePlayerSession((await Player.GetSession()) as Partial<PlayerSession>),
    saveSession: (session) => Player.SaveSession(session),
    recordPlay: (trackId, positionMs) => Player.RecordPlay(trackId, positionMs),
    updateState: (state) => Player.UpdateState(state),
    onTrayCommand: (listener) => {
      const offPlayPause = Events.On('tray:playPause', () => listener('playPause'));
      const offNext = Events.On('tray:next', () => listener('next'));
      const offPrev = Events.On('tray:prev', () => listener('prev'));
      return () => {
        offPlayPause();
        offNext();
        offPrev();
      };
    },
  };
}

function createPreviewApi(): PlayerApi {
  return {
    preview: true,
    async getSession(): Promise<PlayerSession> {
      try {
        const raw = window.localStorage.getItem(PREVIEW_SESSION_KEY);
        if (!raw) return normalizePlayerSession(null);
        return normalizePlayerSession(JSON.parse(raw) as Partial<PlayerSession>);
      } catch {
        return normalizePlayerSession(null);
      }
    },
    async saveSession(session: PlayerSession): Promise<void> {
      try {
        window.localStorage.setItem(
          PREVIEW_SESSION_KEY,
          JSON.stringify(normalizePlayerSession(session))
        );
      } catch {
        // A full or blocked localStorage must never interrupt playback.
      }
    },
    async recordPlay(): Promise<void> {
      // Preview history is synthetic; there is no database to record into.
    },
    async updateState(): Promise<void> {
      // The browser has no tray.
    },
    onTrayCommand(): () => void {
      return () => {};
    },
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('player runtime did not respond')), ms);
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

let apiPromise: Promise<PlayerApi> | null = null;

/**
 * Resolves the player once per page. A cheap session read probes the Wails
 * bridge; a plain browser preview falls back to localStorage.
 */
export function getPlayerApi(): Promise<PlayerApi> {
  apiPromise ??= detectPlayer();
  return apiPromise;
}

async function detectPlayer(): Promise<PlayerApi> {
  if (typeof window === 'undefined') return createPreviewApi();
  try {
    // Wrap in a promise so a synchronous bridge failure is caught as well.
    await withTimeout(Promise.resolve().then(() => Player.GetSession()), 1500);
    return createDesktopApi();
  } catch {
    return createPreviewApi();
  }
}
