'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { loadDesktopRuntime } from '@/lib/desktop-runtime';
import {
  EMPTY_PLAYER_STATE,
  getPlayerApi,
  normalizePlayerState,
  type PlayerApi,
  type PlayerCommand,
} from '@/lib/player-api';
import type { PlayerState } from '@/lib/types';
import { getWindowApi, type WindowApi } from '@/lib/window-api';
import { MiniPlayer } from './MiniPlayer';

interface PositionAnchor {
  positionMs: number;
  at: number;
  playing: boolean;
}

/**
 * The compact window. It has no audio engine of its own: the hidden full
 * window owns the `HTMLAudioElement`, reports state through Go, and executes
 * the transport commands sent from here. That keeps one playback session no
 * matter which window is on screen.
 */
export function MiniWindow() {
  const [state, setState] = useState<PlayerState>(EMPTY_PLAYER_STATE);
  const [positionMs, setPositionMs] = useState(0);
  const anchorRef = useRef<PositionAnchor>({
    positionMs: 0,
    at: 0,
    playing: false,
  });
  const playerApiRef = useRef<PlayerApi | null>(null);
  const windowApiRef = useRef<WindowApi | null>(null);

  const applyState = useCallback((next: PlayerState) => {
    setState(next);
    anchorRef.current = {
      positionMs: next.positionMs,
      at: performance.now(),
      playing: next.playing,
    };
    setPositionMs(next.positionMs);
  }, []);

  const send = useCallback((command: PlayerCommand) => {
    void playerApiRef.current?.sendCommand(command).catch(() => {
      // A dropped command is recoverable; the next state report resyncs.
    });
  }, []);

  useEffect(() => {
    void loadDesktopRuntime();
  }, []);

  // Subscribe once, then seed from the cached state Go keeps for exactly this
  // purpose. The state arrives before the first paint in the common case
  // because the compact window is preloaded hidden at startup.
  useEffect(() => {
    let closed = false;
    let offState: (() => void) | undefined;
    void (async () => {
      try {
        const api = await getPlayerApi();
        if (closed) return;
        playerApiRef.current = api;
        applyState(normalizePlayerState(await api.getState()));
        if (closed) return;
        offState = api.onState(applyState);
      } catch {
        // No bridge: the browser preview drives the compact layout in place.
      }
    })();
    return () => {
      closed = true;
      offState?.();
    };
  }, [applyState]);

  useEffect(() => {
    let closed = false;
    void getWindowApi().then((api) => {
      if (!closed) windowApiRef.current = api;
    });
    return () => {
      closed = true;
    };
  }, []);

  // Walk the clock locally between Go's reports (one per second while
  // playing) so the progress strip moves smoothly without a second engine.
  useEffect(() => {
    if (!state.playing) return;
    const timer = window.setInterval(() => {
      const anchor = anchorRef.current;
      if (!anchor.playing) return;
      const durationMs = anchorRef.current.positionMs > 0 ? state.durationMs : 0;
      const elapsed = performance.now() - anchor.at;
      const next = durationMs > 0
        ? Math.min(durationMs, anchor.positionMs + elapsed)
        : anchor.positionMs;
      setPositionMs(next);
    }, 250);
    return () => window.clearInterval(timer);
  }, [state.playing, state.durationMs]);

  // Compact-window shortcuts mirror the transport keys of the full player.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        void windowApiRef.current?.showFull();
        return;
      }
      if (event.code === 'Space') {
        event.preventDefault();
        send({ action: 'playPause' });
      } else if (event.key === 'n' || event.key === 'N') {
        send({ action: 'next' });
      } else if (event.key === 'p' || event.key === 'P') {
        send({ action: 'prev' });
      } else if (event.key === 'l' || event.key === 'L') {
        send({ action: 'toggleLike' });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [send]);

  const durationSec = state.durationMs / 1000;
  const track = state.trackId > 0
    ? {
        title: state.title || 'Nothing playing',
        artist: state.artist || 'WAVEN',
        album: state.album,
        coverSrc: state.coverSrc,
        durationSec,
      }
    : null;

  return (
    <MiniPlayer
      track={track}
      isPlaying={state.playing}
      currentTime={positionMs / 1000}
      duration={durationSec}
      isLiked={state.liked}
      onTogglePlay={() => send({ action: 'playPause' })}
      onPrev={() => send({ action: 'prev' })}
      onNext={() => send({ action: 'next' })}
      onSeek={(seconds) => send({ action: 'seek', positionMs: Math.round(seconds * 1000) })}
      onToggleLike={() => send({ action: 'toggleLike' })}
      onExpand={() => void windowApiRef.current?.showFull()}
      onHide={() => void windowApiRef.current?.hide()}
    />
  );
}
