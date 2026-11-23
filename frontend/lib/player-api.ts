'use client';

import { Events } from '@wailsio/runtime';
import * as Player from '@/bindings/waven/internal/desktop/playerservice';
import { normalizePlayerSession } from './player-logic';
import type { PlayerSession, PlayerState } from './types';

/** Commands the compact window sends to the full window, which owns playback. */
export type PlayerCommand =
  | { action: 'playPause' | 'next' | 'prev' | 'toggleLike' }
  | { action: 'seek'; positionMs: number };

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
  /** Last state reported by the main window; used when the mini window mounts. */
  getState(): Promise<PlayerState>;
  /** Fires whenever the main window reports a now-playing change. */
  onState(listener: (state: PlayerState) => void): () => void;
  /** Transport commands from the compact window, handled by the full window. */
  onCommand(listener: (command: PlayerCommand) => void): () => void;
  /** Sends a transport command from the compact window to the full window. */
  sendCommand(command: PlayerCommand): Promise<void>;
  onTrayCommand(listener: (command: TrayCommand) => void): () => void;
}

const PREVIEW_SESSION_KEY = 'waven_player_session_v1';

export const EMPTY_PLAYER_STATE: PlayerState = {
  trackId: 0,
  title: '',
  artist: '',
  album: '',
  coverSrc: '',
  liked: false,
  playing: false,
  positionMs: 0,
  durationMs: 0,
};

/** Guards against an older binding or a partial event payload. */
export function normalizePlayerState(
  state: Partial<PlayerState> | null | undefined
): PlayerState {
  if (!state) return EMPTY_PLAYER_STATE;
  return {
    trackId: Number(state.trackId) || 0,
    title: String(state.title ?? ''),
    artist: String(state.artist ?? ''),
    album: String(state.album ?? ''),
    coverSrc: String(state.coverSrc ?? ''),
    liked: Boolean(state.liked),
    playing: Boolean(state.playing),
    positionMs: Math.max(0, Number(state.positionMs) || 0),
    durationMs: Math.max(0, Number(state.durationMs) || 0),
  };
}

function createDesktopApi(): PlayerApi {
  return {
    preview: false,
    getSession: async () =>
      normalizePlayerSession((await Player.GetSession()) as Partial<PlayerSession>),
    saveSession: (session) => Player.SaveSession(session),
    recordPlay: (trackId, positionMs) => Player.RecordPlay(trackId, positionMs),
    updateState: (state) => Player.UpdateState(state),
    getState: async () => normalizePlayerState((await Player.GetState()) as Partial<PlayerState>),
    onState: (listener) =>
      Events.On('player:state', (event) => {
        listener(normalizePlayerState(event.data as Partial<PlayerState> | null));
      }),
    onCommand: (listener) =>
      Events.On('player:command', (event) => {
        listener(event.data as PlayerCommand);
      }),
    sendCommand: async (command) => {
      await Events.Emit('player:command', command);
    },
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
      // The browser has no tray or second window.
    },
    async getState(): Promise<PlayerState> {
      return EMPTY_PLAYER_STATE;
    },
    onState(): () => void {
      return () => {};
    },
    onCommand(): () => void {
      return () => {};
    },
    async sendCommand(): Promise<void> {
      // In the browser preview the mini layout shares this page's engine.
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
