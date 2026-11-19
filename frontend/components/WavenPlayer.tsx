'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { DragEvent } from 'react';
import { motion } from 'motion/react';
import { AlertCircle, FolderPlus, Loader2, X } from 'lucide-react';
import { PlayerEngine, type PlaybackError } from '@/lib/player-engine';
import { getPlayerApi } from '@/lib/player-api';
import { loadDesktopRuntime } from '@/lib/desktop-runtime';
import {
  buildShuffleOrder,
  clampResumeSeconds,
  dedupeIds,
  getNextTrackId,
  getPlaybackOrder,
  getPrevTrackId,
  normalizePlayerSession,
  playRecordThresholdSeconds,
} from '@/lib/player-logic';
import type {
  DockSection,
  PlaylistImport,
  PlayerSession,
  RepeatMode,
  SearchResults,
  TopTab,
  Track,
} from '@/lib/types';
import { useLibrary } from '@/lib/use-library';
import { useSettings } from '@/lib/use-settings';
import {
  DEFAULT_WINDOW_MODE,
  getWindowModeSnapshot,
  subscribeWindowMode,
} from '@/lib/window-mode';
import { DesktopControls } from './DesktopControls';
import { FeaturedCardsRow } from './FeaturedCardsRow';
import { LeftDock } from './LeftDock';
import { NowPlayingCard } from './NowPlayingCard';
import { SecondaryViews } from './SecondaryViews';
import { useToast } from './ToastStack';
import { TopPillNav } from './TopPillNav';
import { TrackListPanel } from './TrackListPanel';

const LEGACY_PLAYLISTS_KEY = 'waven_playlists_v2';

const EMPTY_SEARCH: SearchResults = { tracks: [], albums: [], artists: [] };

/**
 * Reads the pre-SQLite localStorage playlists once so they can be imported by
 * the Go store. The store keeps its own marker, so calling this on every launch
 * is safe and only the first import creates rows.
 */
function readLegacyPlaylists(): PlaylistImport[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(LEGACY_PLAYLISTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const imports: PlaylistImport[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== 'object') continue;
      const record = entry as Record<string, unknown>;
      const name = typeof record.name === 'string' ? record.name.trim() : '';
      if (!name) continue;
      const trackIds = Array.isArray(record.trackIds)
        ? record.trackIds.filter(
            (id): id is number => typeof id === 'number' && Number.isInteger(id) && id > 0
          )
        : [];
      const createdAt =
        typeof record.createdAt === 'number' && Number.isFinite(record.createdAt)
          ? record.createdAt
          : 0;
      imports.push({ name, trackIds, createdAt });
    }
    return imports;
  } catch {
    return [];
  }
}

function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  const tag = element.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || element.isContentEditable;
}

export function WavenPlayer() {
  const library = useLibrary();
  const settings = useSettings();
  const { notify } = useToast();
  const playlists = library.playlists;

  const [dockSection, setDockSection] = useState<DockSection>('home');
  const [topTab, setTopTab] = useState<TopTab>('Discover');

  const [currentTrackId, setCurrentTrackId] = useState<number | null>(null);
  const [queueIds, setQueueIds] = useState<number[]>([]);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [shuffle, setShuffle] = useState<boolean>(false);
  const [shuffleOrder, setShuffleOrder] = useState<number[]>([]);
  const [repeat, setRepeat] = useState<RepeatMode>('off');
  const [volume, setVolume] = useState<number>(0.8);
  const [muted, setMuted] = useState<boolean>(false);

  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [playbackError, setPlaybackError] = useState<PlaybackError | null>(null);

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchResponse, setSearchResponse] = useState<{
    query: string;
    results: SearchResults;
  } | null>(null);

  const windowMode = useSyncExternalStore(
    subscribeWindowMode,
    getWindowModeSnapshot,
    () => DEFAULT_WINDOW_MODE
  );

  const engineRef = useRef<PlayerEngine | null>(null);
  const playerApiRef = useRef<Awaited<ReturnType<typeof getPlayerApi>> | null>(null);
  const restoredRef = useRef(false);
  const loadedTrackIdRef = useRef<number | null>(null);
  const resumeRef = useRef<{ trackId: number; seconds: number } | null>(null);
  const seededRef = useRef(false);
  const playRequestRef = useRef(0);

  // Refs mirror the playback state so the engine callbacks, tray listeners,
  // and periodic session writer always read the latest values without
  // re-creating the audio element.
  const currentTrackIdRef = useRef<number | null>(null);
  const queueRef = useRef<number[]>([]);
  const isPlayingRef = useRef(false);
  const currentTimeRef = useRef(0);
  const durationRef = useRef(0);
  const shuffleRef = useRef(false);
  const shuffleOrderRef = useRef<number[]>([]);
  const repeatRef = useRef<RepeatMode>('off');
  const volumeRef = useRef(0.8);
  const mutedRef = useRef(false);

  const listenedMsRef = useRef(0);
  const recordedRef = useRef(false);
  const lastProgressPositionRef = useRef(0);
  const lastCheckpointPositionRef = useRef(0);
  // A restored track is preloaded paused so its metadata can settle. WebKit can
  // leave that preloaded element unable to start later; the first user play
  // reloads it inside the gesture, which is the same reliable path Next uses.
  const needsFreshLoadRef = useRef(false);

  const handleNextRef = useRef<(auto?: boolean) => void>(() => {});
  const handlePrevRef = useRef<() => void>(() => {});
  const handleTogglePlayRef = useRef<() => void>(() => {});
  const reportTrayStateRef = useRef<() => void>(() => {});
  const libraryRef = useRef(library);

  const {
    resolveTrack,
    getTrack,
    hydrateTracks,
    reportDuration,
    toggleLike,
  } = library;

  useEffect(() => {
    libraryRef.current = library;
  }, [library]);

  useEffect(() => {
    currentTrackIdRef.current = currentTrackId;
    queueRef.current = queueIds;
    shuffleRef.current = shuffle;
    shuffleOrderRef.current = shuffleOrder;
    repeatRef.current = repeat;
    volumeRef.current = volume;
    mutedRef.current = muted;
    isPlayingRef.current = isPlaying;
  }, [
    currentTrackId,
    queueIds,
    shuffle,
    shuffleOrder,
    repeat,
    volume,
    muted,
    isPlaying,
  ]);

  const applyPlaying = useCallback((playing: boolean) => {
    isPlayingRef.current = playing;
    setIsPlaying(playing);
  }, []);

  const persistSession = useCallback((overrides?: Partial<PlayerSession>) => {
    if (!restoredRef.current) return;
    const api = playerApiRef.current;
    if (!api) return;
    const queue = overrides?.queueIds ?? queueRef.current;
    const trackId = overrides?.trackId ?? currentTrackIdRef.current ?? 0;
    const session = normalizePlayerSession({
      trackId,
      positionMs:
        overrides?.positionMs ??
        Math.max(0, Math.round(currentTimeRef.current * 1000)),
      queueIds: queue,
      queueIndex: Math.max(0, queue.indexOf(trackId)),
      shuffle: overrides?.shuffle ?? shuffleRef.current,
      shuffleOrder: overrides?.shuffleOrder ?? shuffleOrderRef.current,
      repeat: overrides?.repeat ?? repeatRef.current,
      volume: overrides?.volume ?? volumeRef.current,
      muted: overrides?.muted ?? mutedRef.current,
      updatedAt: Date.now(),
    });
    void api.saveSession(session).catch(() => {
      // A failed save must never interrupt playback.
    });
  }, []);

  // Move pre-SQLite localStorage playlists into the library once the desktop
  // store is reachable. The store records its own marker, so a failed or
  // repeated run never duplicates rows.
  const importLegacyPlaylists = library.importLegacyPlaylists;
  useEffect(() => {
    if (!library.ready) return;
    const legacy = readLegacyPlaylists();
    if (legacy.length === 0) return;
    void importLegacyPlaylists(legacy).then((count) => {
      if (count <= 0) return;
      try {
        window.localStorage.removeItem(LEGACY_PLAYLISTS_KEY);
      } catch {
        // The store marker already prevents duplicates; a failed cleanup is safe.
      }
    });
  }, [library.ready, importLegacyPlaylists]);

  // Bring up the Wails runtime as soon as the interface mounts. This announces
  // the page to the Go shell, which enables the native drag region and lets the
  // shell drive window controls and desktop diagnostics.
  useEffect(() => {
    void loadDesktopRuntime();
  }, []);

  // The single audio element and its Web Audio graph live for the lifetime of
  // the app. React state is updated from rAF progress, not timeupdate.
  useEffect(() => {
    const engine = new PlayerEngine({
      onProgress: (time, dur) => {
        setCurrentTime(time);
        currentTimeRef.current = time;
        durationRef.current = dur;
        setDuration(dur);

        const trackId = loadedTrackIdRef.current;
        if (trackId === null) {
          lastProgressPositionRef.current = time;
          lastCheckpointPositionRef.current = time;
          return;
        }

        // Accumulate only real playback time. A seek can jump forward many
        // seconds and must not count as a listen.
        const delta = time - lastProgressPositionRef.current;
        if (isPlayingRef.current && delta > 0 && delta <= 2) {
          listenedMsRef.current += delta * 1000;
          const threshold = playRecordThresholdSeconds(dur) * 1000;
          if (!recordedRef.current && listenedMsRef.current >= threshold) {
            recordedRef.current = true;
            const api = playerApiRef.current;
            if (api && !libraryRef.current.preview) {
              void api
                .recordPlay(trackId, Math.round(time * 1000))
                .catch(() => {
                  // History is best effort; playback continues either way.
                });
            }
          }
        }
        lastProgressPositionRef.current = time;

        // Checkpoint every five seconds of real playback and refresh the tray
        // too. Progress events keep arriving while the window is hidden (the
        // engine falls back to timeupdate), unlike throttled timers, so a quit
        // from the tray still stores a current position.
        if (!isPlayingRef.current) {
          lastCheckpointPositionRef.current = time;
        } else if (Math.abs(time - lastCheckpointPositionRef.current) >= 5) {
          lastCheckpointPositionRef.current = time;
          persistSession();
          reportTrayStateRef.current();
        }
      },
      onEnded: () => {
        handleNextRef.current(true);
      },
      onMetadata: (seconds) => {
        durationRef.current = seconds;
        const id = loadedTrackIdRef.current;
        if (id !== null) void libraryRef.current.reportDuration(id, seconds);
      },
      onError: (error) => {
        setPlaybackError(error);
        applyPlaying(false);
        persistSession();
      },
      onStatusChange: (status) => {
        // Keep React in step with the media element after a device change,
        // an autoplay block, or a natural ending that happened outside a
        // transport action. Loading a paused track does not flip this because
        // the ref already matches.
        if (status === 'playing') {
          if (!isPlayingRef.current) applyPlaying(true);
        } else if (
          (status === 'paused' || status === 'error' || status === 'idle') &&
          isPlayingRef.current
        ) {
          applyPlaying(false);
        }
      },
    });
    engineRef.current = engine;

    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, [applyPlaying, persistSession]);

  // Restore the saved queue and modes once the player bridge is known. Playback
  // stays paused; the saved position is applied when the track resolves.
  useEffect(() => {
    let closed = false;
    void (async () => {
      const api = await getPlayerApi();
      if (closed) return;
      playerApiRef.current = api;

      let session = normalizePlayerSession(null);
      try {
        session = normalizePlayerSession(await api.getSession());
      } catch {
        // A missing or corrupt session starts a fresh player.
      }
      if (closed) return;

      queueRef.current = session.queueIds;
      setQueueIds(session.queueIds);
      shuffleRef.current = session.shuffle;
      setShuffle(session.shuffle);
      shuffleOrderRef.current = session.shuffleOrder;
      setShuffleOrder(session.shuffleOrder);
      repeatRef.current = session.repeat;
      setRepeat(session.repeat);
      volumeRef.current = session.volume;
      setVolume(session.volume);
      mutedRef.current = session.muted;
      setMuted(session.muted);
      engineRef.current?.setVolume(session.volume);
      engineRef.current?.setMuted(session.muted);

      if (session.trackId > 0) {
        currentTrackIdRef.current = session.trackId;
        setCurrentTrackId(session.trackId);
        const seconds = session.positionMs / 1000;
        currentTimeRef.current = seconds;
        setCurrentTime(seconds);
        resumeRef.current = { trackId: session.trackId, seconds };
      }

      restoredRef.current = true;
      setSessionLoaded(true);
    })();

    return () => {
      closed = true;
    };
  }, []);

  const currentTrack: Track | null =
    currentTrackId === null
      ? null
      : resolveTrack(currentTrackId) ??
        library.recent.find((track) => track.id === currentTrackId) ??
        null;

  // Resolve the restored current track even when it is outside the recent
  // page. The shared index re-renders this component when the lookup lands.
  useEffect(() => {
    if (!sessionLoaded || currentTrackId === null || currentTrack) return;
    void hydrateTracks([currentTrackId]);
  }, [sessionLoaded, currentTrackId, currentTrack, hydrateTracks]);

  const startTrack = useCallback(
    (track: Track, autoplay: boolean, startAtSec = 0) => {
      const start = Number.isFinite(startAtSec) ? Math.max(0, startAtSec) : 0;
      // Invalidate any pending async track lookup from an earlier click.
      playRequestRef.current += 1;
      setPlaybackError(null);
      currentTrackIdRef.current = track.id;
      setCurrentTrackId(track.id);
      loadedTrackIdRef.current = track.id;
      resumeRef.current = null;
      needsFreshLoadRef.current = false;
      currentTimeRef.current = start;
      setCurrentTime(start);
      durationRef.current = track.durationSec > 0 ? track.durationSec : 0;
      setDuration(track.durationSec > 0 ? track.durationSec : 0);
      listenedMsRef.current = 0;
      recordedRef.current = false;
      lastProgressPositionRef.current = start;
      lastCheckpointPositionRef.current = start;
      applyPlaying(autoplay);
      engineRef.current?.loadTrack(track, start, autoplay);
      persistSession({
        trackId: track.id,
        positionMs: Math.round(start * 1000),
        queueIds: queueRef.current,
      });
    },
    [applyPlaying, persistSession]
  );

  // Load the selected track paused when it changes externally (first restore,
  // queue selection, or a resolved lookup). A track that is already loaded is
  // left alone so metadata refreshes never restart playback.
  useEffect(() => {
    if (!sessionLoaded || !library.ready || !currentTrack) return;
    if (loadedTrackIdRef.current === currentTrack.id) return;

    const resume =
      resumeRef.current && resumeRef.current.trackId === currentTrack.id
        ? resumeRef.current.seconds
        : 0;
    resumeRef.current = null;
    const start = clampResumeSeconds(resume * 1000, currentTrack.durationSec);

    loadedTrackIdRef.current = currentTrack.id;
    currentTimeRef.current = start;
    setCurrentTime(start);
    durationRef.current = currentTrack.durationSec > 0 ? currentTrack.durationSec : 0;
    setDuration(currentTrack.durationSec > 0 ? currentTrack.durationSec : 0);
    listenedMsRef.current = 0;
    recordedRef.current = false;
    lastProgressPositionRef.current = start;
    lastCheckpointPositionRef.current = start;
    needsFreshLoadRef.current = Boolean(currentTrack.audioUrl);
    applyPlaying(false);
    engineRef.current?.loadTrack(currentTrack, start, false);
    setPlaybackError(null);
  }, [
    sessionLoaded,
    library.ready,
    currentTrack,
    applyPlaying,
  ]);

  // Seed the first visit with the recent tracks, but never override a restored
  // or user-built queue.
  useEffect(() => {
    if (!sessionLoaded || !library.ready || seededRef.current) return;
    if (currentTrackId !== null || queueIds.length > 0) return;
    if (library.recent.length === 0) return;
    seededRef.current = true;
    const first = library.recent[0];
    const ids = library.recent.map((track) => track.id);
    queueRef.current = ids;
    // This effect imports the first library page into player state exactly
    // once; the guard above makes it a one-shot synchronization.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQueueIds(ids);
    currentTrackIdRef.current = first.id;
    setCurrentTrackId(first.id);
    if (shuffleRef.current) {
      const order = buildShuffleOrder(ids, first.id);
      shuffleOrderRef.current = order;
      setShuffleOrder(order);
    }
  }, [sessionLoaded, library.ready, library.recent, currentTrackId, queueIds.length]);

  // Keep the saved shuffle order in step with queue edits without reshuffling
  // the tracks that are already in order.
  useEffect(() => {
    if (!shuffle) return;
    const next = getPlaybackOrder(queueIds, true, shuffleOrderRef.current);
    const current = shuffleOrderRef.current;
    if (next.length === current.length && next.every((id, index) => id === current[index])) {
      return;
    }
    shuffleOrderRef.current = next;
    setShuffleOrder(next);
  }, [queueIds, shuffle]);

  // Persist soft changes (queue edits, volume, modes) on a short debounce.
  useEffect(() => {
    if (!sessionLoaded) return;
    const timer = window.setTimeout(() => persistSession(), 500);
    return () => window.clearTimeout(timer);
  }, [
    sessionLoaded,
    currentTrackId,
    queueIds,
    shuffle,
    shuffleOrder,
    repeat,
    volume,
    muted,
    persistSession,
  ]);

  // Save on hide and unload. The Go ServiceShutdown also flushes the last
  // reported position if the webview never gets a chance to run these.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const save = () => persistSession();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') save();
    };
    window.addEventListener('pagehide', save);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', save);
      document.removeEventListener('visibilitychange', onVisibility);
      save();
    };
  }, [persistSession]);

  const resolveTrackCached = useCallback(
    (id: number): Track | undefined => resolveTrack(id),
    [resolveTrack]
  );

  const playById = useCallback(
    (id: number) => {
      const token = playRequestRef.current + 1;
      playRequestRef.current = token;
      const cached = resolveTrackCached(id);
      if (cached) {
        startTrack(cached, true);
        return;
      }
      void getTrack(id).then((track) => {
        if (playRequestRef.current !== token) return;
        if (track) {
          startTrack(track, true);
          return;
        }
        setPlaybackError({
          code: 'unknown',
          message: 'That track is no longer in your library.',
        });
        applyPlaying(false);
      });
    },
    [applyPlaying, getTrack, resolveTrackCached, startTrack]
  );

  const playTrack = useCallback(
    (track: Track, customQueue?: Track[]) => {
      if (customQueue && customQueue.length > 0) {
        const ids = dedupeIds(customQueue.map((entry) => entry.id));
        const changed =
          ids.length !== queueRef.current.length ||
          ids.some((id, index) => id !== queueRef.current[index]);
        if (changed) {
          queueRef.current = ids;
          setQueueIds(ids);
          if (shuffleRef.current) {
            // A new queue (album, playlist, mix) starts a fresh stable order
            // with the chosen track first. Selecting another track from the
            // queue that is already active leaves the order untouched.
            const order = buildShuffleOrder(ids, track.id);
            shuffleOrderRef.current = order;
            setShuffleOrder(order);
          }
        }
      } else if (!queueRef.current.includes(track.id)) {
        const next = [...queueRef.current, track.id];
        queueRef.current = next;
        setQueueIds(next);
        if (shuffleRef.current) {
          const order = [...shuffleOrderRef.current, track.id];
          shuffleOrderRef.current = order;
          setShuffleOrder(order);
        }
      }

      if (track.id === currentTrackIdRef.current && loadedTrackIdRef.current === track.id) {
        if (isPlayingRef.current) {
          engineRef.current?.pause();
          applyPlaying(false);
          persistSession();
        } else if (needsFreshLoadRef.current) {
          // The restored element was preloaded paused. Recreate it now so the
          // browser starts playback inside this user gesture.
          startTrack(track, true, currentTimeRef.current);
        } else {
          setPlaybackError(null);
          applyPlaying(true);
          void engineRef.current?.play();
        }
        return;
      }

      startTrack(track, true);
    },
    [applyPlaying, persistSession, startTrack]
  );

  const handleTogglePlay = useCallback(() => {
    const track = currentTrack;
    const engine = engineRef.current;
    if (!track || !engine) return;

    if (isPlayingRef.current) {
      engine.pause();
      applyPlaying(false);
      persistSession();
      return;
    }

    if (loadedTrackIdRef.current !== track.id) {
      startTrack(track, true, currentTimeRef.current);
      return;
    }

    if (needsFreshLoadRef.current) {
      // A restored track is preloaded paused. Recreate the element inside this
      // gesture; WebKit does not always start a preloaded element afterwards.
      startTrack(track, true, currentTimeRef.current);
      return;
    }

    // A media element keeps its failed source. Reload before retrying so a
    // transient read failure does not leave play permanently dead.
    if (engine.getStatus() === 'error') {
      startTrack(track, true, currentTimeRef.current);
      return;
    }

    setPlaybackError(null);
    applyPlaying(true);
    void engine.play();
  }, [applyPlaying, currentTrack, persistSession, startTrack]);

  useEffect(() => {
    handleTogglePlayRef.current = handleTogglePlay;
  }, [handleTogglePlay]);

  const handleNext = useCallback(
    (auto = false) => {
      const current = currentTrackIdRef.current;
      if (current === null) return;
      const nextId = getNextTrackId({
        queueIds: queueRef.current,
        currentTrackId: current,
        shuffle: shuffleRef.current,
        repeat: repeatRef.current,
        shuffleOrder: shuffleOrderRef.current,
        autoAdvance: auto,
      });
      if (nextId === null) {
        if (auto) {
          // A finished non-looping queue stops cleanly at the start of the
          // current track, ready for a deliberate replay.
          applyPlaying(false);
          engineRef.current?.seek(0);
          currentTimeRef.current = 0;
          setCurrentTime(0);
          listenedMsRef.current = 0;
          recordedRef.current = false;
          lastProgressPositionRef.current = 0;
          lastCheckpointPositionRef.current = 0;
          persistSession({ positionMs: 0 });
        }
        return;
      }
      playById(nextId);
    },
    [applyPlaying, persistSession, playById]
  );

  useEffect(() => {
    handleNextRef.current = (auto = false) => handleNext(auto);
  }, [handleNext]);

  const handlePrev = useCallback(() => {
    const current = currentTrackIdRef.current;
    if (current === null) return;
    if (currentTimeRef.current > 3) {
      engineRef.current?.seek(0);
      currentTimeRef.current = 0;
      setCurrentTime(0);
      lastProgressPositionRef.current = 0;
      lastCheckpointPositionRef.current = 0;
      persistSession({ positionMs: 0 });
      return;
    }
    const prevId = getPrevTrackId({
      queueIds: queueRef.current,
      currentTrackId: current,
      shuffle: shuffleRef.current,
      shuffleOrder: shuffleOrderRef.current,
      repeat: repeatRef.current,
    });
    if (prevId !== null) {
      playById(prevId);
    } else {
      engineRef.current?.seek(0);
      currentTimeRef.current = 0;
      setCurrentTime(0);
      lastProgressPositionRef.current = 0;
      lastCheckpointPositionRef.current = 0;
      persistSession({ positionMs: 0 });
    }
  }, [persistSession, playById]);

  useEffect(() => {
    handlePrevRef.current = handlePrev;
  }, [handlePrev]);

  const handleSeek = useCallback((sec: number) => {
    const target = Number.isFinite(sec) ? Math.max(0, sec) : 0;
    engineRef.current?.seek(target);
    currentTimeRef.current = target;
    setCurrentTime(target);
    lastProgressPositionRef.current = target;
    lastCheckpointPositionRef.current = target;
    persistSession({ positionMs: Math.round(target * 1000) });
    reportTrayStateRef.current();
  }, [persistSession]);

  const handleVolumeChange = useCallback((vol: number) => {
    const next = Math.max(0, Math.min(1, vol));
    const nextMuted = next === 0;
    volumeRef.current = next;
    mutedRef.current = nextMuted;
    setVolume(next);
    setMuted(nextMuted);
    engineRef.current?.setMuted(nextMuted);
    engineRef.current?.setVolume(next);
  }, []);

  const handleToggleMute = useCallback(() => {
    const nextMuted = !mutedRef.current;
    mutedRef.current = nextMuted;
    setMuted(nextMuted);
    engineRef.current?.setMuted(nextMuted);
  }, []);

  const handleToggleLike = useCallback(
    (trackId: number) => {
      void toggleLike(trackId);
    },
    [toggleLike]
  );

  const handleCycleRepeat = useCallback(() => {
    const next: RepeatMode =
      repeatRef.current === 'off' ? 'all' : repeatRef.current === 'all' ? 'one' : 'off';
    repeatRef.current = next;
    setRepeat(next);
  }, []);

  const handleToggleShuffle = useCallback(() => {
    const next = !shuffleRef.current;
    shuffleRef.current = next;
    setShuffle(next);
    if (next) {
      const order = buildShuffleOrder(queueRef.current, currentTrackIdRef.current);
      shuffleOrderRef.current = order;
      setShuffleOrder(order);
    }
  }, []);

  const handleAddToQueue = useCallback((track: Track) => {
    if (queueRef.current.includes(track.id)) return;
    const next = [...queueRef.current, track.id];
    queueRef.current = next;
    setQueueIds(next);
    if (shuffleRef.current) {
      const order = [...shuffleOrderRef.current, track.id];
      shuffleOrderRef.current = order;
      setShuffleOrder(order);
    }
  }, []);

  const handleRemoveFromQueue = useCallback(
    (trackId: number) => {
      const previous = queueRef.current;
      const removedIndex = previous.indexOf(trackId);
      if (removedIndex === -1) return;
      const next = previous.filter((id) => id !== trackId);
      queueRef.current = next;
      setQueueIds(next);
      if (shuffleRef.current) {
        const order = shuffleOrderRef.current.filter((id) => id !== trackId);
        shuffleOrderRef.current = order;
        setShuffleOrder(order);
      }
      if (currentTrackIdRef.current !== trackId) return;

      if (next.length > 0) {
        playById(next[Math.min(removedIndex, next.length - 1)]);
        return;
      }
      loadedTrackIdRef.current = null;
      engineRef.current?.pause();
      applyPlaying(false);
      currentTrackIdRef.current = null;
      setCurrentTrackId(null);
      currentTimeRef.current = 0;
      setCurrentTime(0);
      setDuration(0);
      persistSession({ trackId: 0, positionMs: 0, queueIds: next });
    },
    [applyPlaying, persistSession, playById]
  );

  const handleAddToPlaylist = useCallback(
    (playlistId: number, trackId: number) => {
      void library.addTrackToPlaylist(playlistId, trackId).then((ok) => {
        if (!ok) return;
        const playlist = library.playlists.find((entry) => entry.id === playlistId);
        const track = library.resolveTrack(trackId);
        notify(
          playlist
            ? `Added ${track ? `“${track.title}”` : 'track'} to ${playlist.name}.`
            : 'Added to playlist.',
          'success'
        );
      });
    },
    [library, notify]
  );

  const handleRemoveFromPlaylist = useCallback(
    (playlistId: number, trackId: number) => {
      void library.removeFromPlaylist(playlistId, trackId);
    },
    [library]
  );

  const handleCreatePlaylist = useCallback(
    (name: string) => {
      void library.createPlaylist(name).then((playlist) => {
        if (playlist) notify(`Created playlist “${playlist.name}”.`, 'success');
      });
    },
    [library, notify]
  );

  const handleRenamePlaylist = useCallback(
    (playlistId: number, name: string) => {
      void library.renamePlaylist(playlistId, name).then((ok) => {
        if (ok) notify(`Renamed playlist to “${name.trim()}”.`, 'success');
      });
    },
    [library, notify]
  );

  const handleDeletePlaylist = useCallback(
    (playlistId: number) => {
      const playlist = library.playlists.find((entry) => entry.id === playlistId);
      void library.deletePlaylist(playlistId).then((ok) => {
        if (ok) notify(playlist ? `Deleted “${playlist.name}”.` : 'Playlist deleted.', 'success');
      });
    },
    [library, notify]
  );

  const handleReorderPlaylist = useCallback(
    (playlistId: number, trackIds: number[]) => {
      void library.reorderPlaylist(playlistId, trackIds);
    },
    [library]
  );

  // Tray transport commands. The refs keep the listeners mounted once while
  // always calling the latest handlers.
  useEffect(() => {
    let closed = false;
    let off: (() => void) | undefined;
    void getPlayerApi().then((api) => {
      if (closed) return;
      off = api.onTrayCommand((command) => {
        if (command === 'playPause') handleTogglePlayRef.current();
        else if (command === 'next') handleNextRef.current(false);
        else handlePrevRef.current();
      });
    });
    return () => {
      closed = true;
      off?.();
    };
  }, []);

  // Mirror the now-playing track into the tray on changes and every five
  // seconds while playing so diagnostics and the menu stay current.
  const reportTrayState = useCallback(() => {
    const api = playerApiRef.current;
    if (!api) return;
    const id = currentTrackIdRef.current;
    if (id === null) {
      void api
        .updateState({
          trackId: 0,
          title: '',
          artist: '',
          playing: false,
          positionMs: 0,
          durationMs: 0,
        })
        .catch(() => {});
      return;
    }
    const track = libraryRef.current.resolveTrack(id);
    if (!track) return;
    void api
      .updateState({
        trackId: id,
        title: track.title,
        artist: track.artist,
        playing: isPlayingRef.current,
        positionMs: Math.max(0, Math.round(currentTimeRef.current * 1000)),
        durationMs: Math.max(
          0,
          Math.round(
            (durationRef.current > 0 ? durationRef.current : track.durationSec) * 1000
          )
        ),
      })
      .catch(() => {});
  }, []);

  // Keep the progress callback pointed at the latest tray reporter. The engine
  // owns the five-second refresh through real playback progress, which keeps
  // working while the window is hidden.
  useEffect(() => {
    reportTrayStateRef.current = reportTrayState;
  }, [reportTrayState]);

  useEffect(() => {
    if (!sessionLoaded) return;
    reportTrayState();
    // currentTrack is resolved asynchronously for restored tracks; reporting
    // again when it lands avoids a stale "Nothing playing" tray label.
  }, [sessionLoaded, currentTrackId, isPlaying, currentTrack, reportTrayState]);

  // Surface scan completion as a transient toast.
  const lastScan = library.scan.last;
  useEffect(() => {
    if (!lastScan) return;
    let message: string;
    if (lastScan.canceled) {
      message = 'Scan cancelled. Unchanged files were left in place.';
    } else {
      const parts = [
        lastScan.added > 0 ? `${lastScan.added} added` : '',
        lastScan.updated > 0 ? `${lastScan.updated} updated` : '',
        lastScan.skipped > 0 ? `${lastScan.skipped} unchanged` : '',
        lastScan.missing > 0 ? `${lastScan.missing} missing` : '',
        lastScan.errors.length > 0 ? `${lastScan.errors.length} skipped` : '',
      ].filter(Boolean);
      message =
        parts.length > 0
          ? `Scan complete — ${parts.join(', ')}.`
          : 'Scan complete. No changes found.';
    }
    notify(message, lastScan.errors.length > 0 ? 'info' : 'success');
  }, [lastScan, notify]);

  // Native file drops import folders through the backend; report the outcome
  // and clear the pending drop so it cannot fire twice.
  const drop = library.drop;
  const clearDrop = library.clearDrop;
  useEffect(() => {
    if (!drop) return;
    if (drop.error) {
      notify(drop.error, 'error');
    } else {
      const result = drop.result;
      const addedCount = result?.added.length ?? 0;
      const existingCount = result?.existing.length ?? 0;
      const warningCount = result?.warnings.length ?? 0;
      const parts = [
        addedCount > 0 ? `${addedCount} folder${addedCount === 1 ? '' : 's'} added` : '',
        existingCount > 0 ? `${existingCount} already in your library` : '',
        warningCount > 0 ? `${warningCount} path${warningCount === 1 ? '' : 's'} skipped` : '',
      ].filter(Boolean);
      notify(
        parts.length > 0 ? `Drop complete — ${parts.join(', ')}.` : 'Nothing new to import.',
        addedCount > 0 ? 'success' : 'info'
      );
    }
    clearDrop();
  }, [drop, clearDrop, notify]);

  // Library-level failures (scan, playlist writes, likes) surface as toasts so
  // they are noticed wherever the user is in the app.
  const libraryError = library.error;
  const clearLibraryError = library.clearError;
  useEffect(() => {
    if (!libraryError) return;
    notify(libraryError, 'error');
    clearLibraryError();
  }, [libraryError, clearLibraryError, notify]);

  // Debounced local-library search. The backend normalizes accents and ranks
  // title/artist prefix matches ahead of substring matches. Results are keyed by
  // query so typing never shows a previous query's hits.
  const searchLibrary = library.search;
  const trimmedSearchQuery = searchQuery.trim();
  const searchResults =
    searchResponse && searchResponse.query === trimmedSearchQuery
      ? searchResponse.results
      : EMPTY_SEARCH;
  const searchLoading =
    trimmedSearchQuery.length > 0 && searchResponse?.query !== trimmedSearchQuery;

  useEffect(() => {
    const query = searchQuery.trim();
    if (!query) return;
    let active = true;
    const timer = window.setTimeout(async () => {
      try {
        const results = await searchLibrary(query);
        if (active) setSearchResponse({ query, results });
      } catch {
        if (active) setSearchResponse({ query, results: EMPTY_SEARCH });
      }
    }, 150);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [searchQuery, searchLibrary]);

  const handleNavigate = useCallback((section: DockSection, tab?: TopTab) => {
    setDockSection(section);
    if (tab) setTopTab(tab);
  }, []);

  // Global keyboard shortcuts (ignore when typing in inputs).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      const target = event.target as HTMLElement | null;
      // Space on a focused button already activates that button; running the
      // global transport shortcut too would toggle twice. The seek slider
      // handles its own arrow keys for the same reason.
      if (
        event.code === 'Space' &&
        target &&
        (target.tagName === 'BUTTON' || target.tagName === 'A')
      ) {
        return;
      }
      if (
        (event.key === 'ArrowRight' || event.key === 'ArrowLeft') &&
        target?.getAttribute('role') === 'slider'
      ) {
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        setDockSection('search');
        window.setTimeout(() => {
          document.getElementById('waven-global-search')?.focus();
        }, 0);
        return;
      }
      if (event.key === 'Escape') {
        setDockSection('home');
        setTopTab('Discover');
        return;
      }
      if (event.code === 'Space') {
        event.preventDefault();
        handleTogglePlay();
      } else if (event.key === 'n' || event.key === 'N') {
        handleNext(false);
      } else if (event.key === 'p' || event.key === 'P') {
        handlePrev();
      } else if (event.key === 'ArrowRight' && currentTrack) {
        handleSeek(Math.min(duration, currentTime + 5));
      } else if (event.key === 'ArrowLeft' && currentTrack) {
        handleSeek(Math.max(0, currentTime - 5));
      } else if ((event.key === 'l' || event.key === 'L') && currentTrack) {
        handleToggleLike(currentTrack.id);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    handleTogglePlay,
    handleNext,
    handlePrev,
    handleToggleLike,
    handleSeek,
    currentTrack,
    currentTime,
    duration,
  ]);

  const readAnalyser = useCallback((target: Uint8Array) => {
    return engineRef.current?.readAnalyser(target) ?? false;
  }, []);

  // The Wails runtime handles native drops; these guards keep a stray browser
  // drop from navigating the webview, and explain the preview limitation.
  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
  }, []);

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!event.dataTransfer?.types.includes('Files')) return;
      event.preventDefault();
      if (!library.preview) return;
      notify(
        'Folder drops work in the desktop app. Use Add folder in the Library tab here.',
        'info'
      );
    },
    [library.preview, notify]
  );

  const featuredTracks = useMemo(() => library.recent.slice(0, 3), [library.recent]);

  const isCurrentLiked =
    currentTrack !== null && (library.likes.has(currentTrack.id) || currentTrack.liked);

  const showDiscoverEmpty = library.ready && library.recent.length === 0;

  return (
    <div
      data-window-mode={windowMode}
      data-file-drop-target="waven-library"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className="waven-app relative min-h-screen w-full flex items-center justify-center px-3 py-4 sm:px-6 lg:px-10 pb-24 lg:pb-10 overflow-x-hidden"
    >
      {/* Drop affordance. The Wails runtime toggles .file-drop-target-active on
          this element while files hover the window. */}
      <div
        aria-hidden="true"
        className="waven-drop-overlay pointer-events-none fixed inset-0 z-[75] items-center justify-center p-6"
      >
        <div className="flex flex-col items-center gap-2 rounded-[28px] border border-dashed border-white/30 bg-[#0b0e15]/88 px-10 py-8 text-center shadow-[0_24px_80px_rgba(0,0,0,0.7)] backdrop-blur-2xl">
          <FolderPlus className="h-8 w-8 text-white/80" />
          <p className="font-display text-sm font-semibold text-white">Drop folders to add them</p>
          <p className="text-xs text-white/55">
            Files join their parent folder, then scan into your library.
          </p>
        </div>
      </div>
      {/* Ambient Atmospheric Backdrop mirroring current cover */}
      <div
        aria-hidden="true"
        className="waven-ambient pointer-events-none fixed inset-0 z-0 overflow-hidden"
      >
        {currentTrack?.coverSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={currentTrack.coverSrc}
            alt=""
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover opacity-40 blur-[110px] scale-125 transition-all duration-1000"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-[#101426] via-[#0a0c12] to-black" />
        )}
        <div className="absolute inset-0 bg-gradient-to-br from-[#06070a]/85 via-[#0a0c12]/72 to-[#050609]/90" />
      </div>

      {/* Centered Spatial Glassmorphic Shell + Floating Left Dock */}
      <div className="relative z-10 w-full max-w-[1180px] min-w-0 flex items-center gap-4 lg:gap-6">
        <LeftDock
          activeSection={dockSection}
          onSelectSection={(section) => {
            setDockSection(section);
            if (section === 'home') setTopTab('Discover');
          }}
          likedCount={library.stats.liked || library.likes.size}
        />

        {/* Main Frosted Glass Window */}
        <motion.main
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          className="relative flex-1 min-w-0 w-full rounded-[28px] sm:rounded-[34px] bg-white/[0.045] backdrop-blur-3xl border border-white/[0.12] shadow-[0_32px_90px_rgba(0,0,0,0.75)] p-4 sm:p-7 lg:p-8 lg:pt-9"
        >
          {/* Floating Centered Top Pill Navigation */}
          <div className="flex justify-center mb-4 lg:mb-0 lg:absolute lg:-top-6 lg:left-1/2 lg:-translate-x-1/2 z-30 max-w-full">
            <TopPillNav
              activeTab={topTab}
              onSelectTab={(tab) => {
                setTopTab(tab);
                setDockSection('home');
              }}
            />
          </div>

          {/* Top-left WAVEN Brand Wordmark + desktop window controls */}
          <header className="wails-drag -mx-1 mb-4 flex select-none items-center justify-between px-1 lg:mb-5">
            <button
              type="button"
              onClick={() => {
                setDockSection('home');
                setTopTab('Discover');
              }}
              className="wails-no-drag font-display text-xl sm:text-[22px] font-extrabold tracking-[0.08em] text-white uppercase focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 rounded-md"
            >
              WAVEN
            </button>
            {library.preview && (
              <span
                title="The desktop library is unavailable in a browser. Folders and tracks below are preview data."
                className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-amber-300/25 bg-amber-300/10 px-2.5 py-1 text-[10px] font-medium text-amber-100/80"
              >
                Browser preview
              </span>
            )}
            <DesktopControls
              mode={windowMode}
              onModeChange={(mode) => void settings.update({ windowMode: mode })}
            />
          </header>

          {/* 2-Column Content Area */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 lg:gap-6 items-stretch">
            {/* Left Workspace Column */}
            <div className="lg:col-span-7 min-w-0 flex flex-col gap-5">
              {dockSection === 'home' && topTab === 'Discover' ? (
                <>
                  {library.scan.running && (
                    <div className="rounded-[20px] bg-white/[0.06] border border-white/[0.12] px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <Loader2 className="w-4 h-4 text-white/70 animate-spin shrink-0" />
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-white">
                              {library.scan.progress.phase === 'discovering'
                                ? 'Finding audio files…'
                                : 'Scanning library…'}
                            </p>
                            <p className="text-[11px] text-white/50 truncate">
                              {library.scan.progress.folderPath ||
                                library.scan.progress.currentPath ||
                                'Preparing scan'}
                            </p>
                          </div>
                        </div>
                        <span className="font-mono-tabular text-[11px] text-white/65 shrink-0">
                          {library.scan.progress.total > 0
                            ? `${library.scan.progress.done} / ${library.scan.progress.total}`
                            : ''}
                        </span>
                        <button
                          type="button"
                          onClick={() => void library.cancelScan()}
                          className="px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 border border-white/15 text-[11px] text-white shrink-0"
                        >
                          Cancel
                        </button>
                      </div>
                      <div className="mt-2.5 h-1 rounded-full bg-white/15 overflow-hidden">
                        <div
                          className="h-full bg-white/80 rounded-full transition-[width] duration-300"
                          style={{
                            width:
                              library.scan.progress.total > 0
                                ? `${Math.min(
                                    100,
                                    (library.scan.progress.done / library.scan.progress.total) * 100
                                  )}%`
                                : '12%',
                          }}
                        />
                      </div>
                    </div>
                  )}

                  {showDiscoverEmpty ? (
                    <section className="rounded-[26px] bg-white/[0.045] backdrop-blur-2xl border border-white/[0.1] p-8 text-center flex flex-col items-center gap-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
                      <div className="w-16 h-16 rounded-2xl bg-white/[0.07] border border-white/10 flex items-center justify-center">
                        <FolderPlus className="w-7 h-7 text-white/60" />
                      </div>
                      <div className="space-y-1.5 max-w-sm">
                        <h2 className="font-display text-lg font-semibold text-white">
                          {library.folders.length > 0
                            ? 'This folder has no playable tracks yet'
                            : 'Bring your music into WAVEN'}
                        </h2>
                        <p className="text-sm text-white/55 leading-relaxed">
                          {library.folders.length > 0
                            ? 'WAVEN supports MP3, AAC/M4A, FLAC, WAV, AIFF, OGG, and Opus. Rescan after adding files.'
                            : 'Choose a folder and WAVEN will scan tags, durations, and embedded artwork automatically. Nothing is uploaded anywhere.'}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center justify-center gap-2">
                        <button
                          type="button"
                          onClick={() => void library.addFolder()}
                          className="px-5 py-2.5 rounded-full bg-white text-[#090b10] text-xs font-semibold hover:bg-white/90 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                        >
                          Add music folder
                        </button>
                        {library.folders.length > 0 && !library.scan.running && (
                          <button
                            type="button"
                            onClick={() => void library.rescan(0)}
                            className="px-5 py-2.5 rounded-full bg-white/10 hover:bg-white/20 border border-white/15 text-xs font-medium text-white"
                          >
                            Rescan folders
                          </button>
                        )}
                      </div>
                    </section>
                  ) : (
                    <>
                      <FeaturedCardsRow
                        tracks={featuredTracks}
                        currentTrackId={currentTrackId}
                        isPlaying={isPlaying}
                        likedIds={library.likes}
                        onPlayTrack={(track) => playTrack(track)}
                        onToggleLike={handleToggleLike}
                      />
                      <TrackListPanel
                        tracks={library.recent}
                        currentTrackId={currentTrackId}
                        isPlaying={isPlaying}
                        likedIds={library.likes}
                        playlists={playlists}
                        onPlayTrack={(track) => playTrack(track, library.recent)}
                        onToggleLike={handleToggleLike}
                        onAddToQueue={handleAddToQueue}
                        onAddToPlaylist={handleAddToPlaylist}
                        emptyMessage={
                          library.ready
                            ? 'No tracks yet. Add a music folder in the Library tab.'
                            : 'Loading your library…'
                        }
                      />
                    </>
                  )}
                </>
              ) : (
                <SecondaryViews
                  library={library}
                  settings={settings}
                  dockSection={dockSection}
                  topTab={topTab}
                  currentTrackId={currentTrackId}
                  isPlaying={isPlaying}
                  likedIds={library.likes}
                  playlists={playlists}
                  queueIds={queueIds}
                  searchQuery={searchQuery}
                  searchResults={searchResults}
                  searchLoading={searchLoading}
                  volume={volume}
                  onSearchChange={setSearchQuery}
                  onPlayTrack={playTrack}
                  onToggleLike={handleToggleLike}
                  onAddToQueue={handleAddToQueue}
                  onAddToPlaylist={handleAddToPlaylist}
                  onRemoveFromPlaylist={handleRemoveFromPlaylist}
                  onCreatePlaylist={handleCreatePlaylist}
                  onRenamePlaylist={handleRenamePlaylist}
                  onDeletePlaylist={handleDeletePlaylist}
                  onReorderPlaylist={handleReorderPlaylist}
                  onRemoveFromQueue={handleRemoveFromQueue}
                  onVolumeChange={handleVolumeChange}
                  onNavigate={handleNavigate}
                  onGoDiscover={() => {
                    setDockSection('home');
                    setTopTab('Discover');
                  }}
                />
              )}
            </div>

            {/* Right Dominant Now Playing Hero Card */}
            <div className="lg:col-span-5 flex">
              <NowPlayingCard
                track={currentTrack}
                isPlaying={isPlaying}
                currentTime={currentTime}
                duration={duration}
                isLiked={isCurrentLiked}
                shuffle={shuffle}
                repeat={repeat}
                volume={volume}
                muted={muted}
                playlists={playlists}
                queueCount={queueIds.length}
                onTogglePlay={handleTogglePlay}
                onPrev={handlePrev}
                onNext={() => handleNext(false)}
                onSeek={handleSeek}
                onToggleLike={handleToggleLike}
                onToggleShuffle={handleToggleShuffle}
                onCycleRepeat={handleCycleRepeat}
                onVolumeChange={handleVolumeChange}
                onToggleMute={handleToggleMute}
                onAddToPlaylist={handleAddToPlaylist}
                onOpenQueue={() => setDockSection('library')}
                onOpenLibrary={() => setDockSection('library')}
                readAnalyser={readAnalyser}
              />
            </div>
          </div>

          {playbackError && (
            <div className="mt-4 flex flex-col gap-2">
              <div
                role="alert"
                className="flex items-center justify-between gap-3 rounded-2xl border border-amber-300/25 bg-amber-400/10 px-4 py-2.5 text-xs text-amber-50"
              >
                <span className="flex items-center gap-2 min-w-0">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span className="truncate">{playbackError.message}</span>
                </span>
                <div className="flex items-center gap-2 shrink-0">
                  {playbackError.code !== 'blocked' && (
                    <button
                      type="button"
                      onClick={() => {
                        setPlaybackError(null);
                        handleNext(false);
                      }}
                      className="rounded-full border border-amber-200/30 bg-amber-200/10 px-2.5 py-1 text-[11px] font-medium text-amber-50 hover:bg-amber-200/20"
                    >
                      Skip
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label="Dismiss playback message"
                    onClick={() => setPlaybackError(null)}
                    className="text-amber-100/70 hover:text-white"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </motion.main>
      </div>
    </div>
  );
}
