'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { motion } from 'motion/react';
import { AlertCircle, FolderPlus, Loader2, X } from 'lucide-react';
import { WavenAudioEngine } from '@/lib/audio-engine';
import { loadDesktopRuntime } from '@/lib/desktop-runtime';
import {
  addTrackToPlaylist,
  getNextTrackId,
  getPrevTrackId,
  removeTrackFromPlaylist,
} from '@/lib/player-logic';
import type {
  DockSection,
  Playlist,
  RepeatMode,
  SearchResults,
  TopTab,
  Track,
} from '@/lib/types';
import { useLibrary } from '@/lib/use-library';
import {
  DEFAULT_WINDOW_MODE,
  getWindowModeSnapshot,
  setWindowMode as setWindowModePreference,
  subscribeWindowMode,
} from '@/lib/window-mode';
import { FeaturedCardsRow } from './FeaturedCardsRow';
import { DesktopControls } from './DesktopControls';
import { LeftDock } from './LeftDock';
import { NowPlayingCard } from './NowPlayingCard';
import { SecondaryViews } from './SecondaryViews';
import { TopPillNav } from './TopPillNav';
import { TrackListPanel } from './TrackListPanel';

const STORAGE_KEYS = {
  playlists: 'waven_playlists_v2',
};

const EMPTY_SEARCH: SearchResults = { tracks: [], albums: [], artists: [] };

function readPlaylists(): Playlist[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.playlists);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (entry): entry is Playlist =>
          Boolean(entry) &&
          typeof (entry as Playlist).id === 'string' &&
          typeof (entry as Playlist).name === 'string' &&
          Array.isArray((entry as Playlist).trackIds)
      )
      .map((entry) => ({
        ...entry,
        trackIds: entry.trackIds.filter((id): id is number => typeof id === 'number'),
      }));
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
  const [playlists, setPlaylists] = useState<Playlist[]>([]);

  const [dockSection, setDockSection] = useState<DockSection>('home');
  const [topTab, setTopTab] = useState<TopTab>('Discover');

  const [currentTrackId, setCurrentTrackId] = useState<number | null>(null);
  const [queueIds, setQueueIds] = useState<number[]>([]);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [shuffle, setShuffle] = useState<boolean>(false);
  const [repeat, setRepeat] = useState<RepeatMode>('all');
  const [volume, setVolume] = useState<number>(0.78);
  const [muted, setMuted] = useState<boolean>(false);

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchResponse, setSearchResponse] = useState<{
    query: string;
    results: SearchResults;
  } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const windowMode = useSyncExternalStore(
    subscribeWindowMode,
    getWindowModeSnapshot,
    () => DEFAULT_WINDOW_MODE
  );

  const engineRef = useRef<WavenAudioEngine | null>(null);
  const loadedTrackIdRef = useRef<number | null>(null);
  const seededRef = useRef(false);
  const handleNextRef = useRef<() => void>(() => {});
  const libraryRef = useRef(library);

  useEffect(() => {
    libraryRef.current = library;
  }, [library]);

  useEffect(() => {
    // Hydrate persisted playlists after mount so the statically exported HTML
    // and the first client render stay identical.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPlaylists(readPlaylists());
  }, []);

  useEffect(() => {
    // Wait for the playlist read above so the initial empty state never
    // overwrites saved playlists in storage.
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(STORAGE_KEYS.playlists, JSON.stringify(playlists));
    } catch {
      // ignore storage failures
    }
  }, [playlists]);

  // Bring up the Wails runtime as soon as the interface mounts. This announces
  // the page to the Go shell, which enables the native drag region and lets the
  // shell drive window controls and desktop diagnostics.
  useEffect(() => {
    void loadDesktopRuntime();
  }, []);

  const currentTrack: Track | null =
    currentTrackId === null
      ? null
      : library.resolveTrack(currentTrackId) ??
        library.recent.find((track) => track.id === currentTrackId) ??
        null;

  // Select the most recent track once the real library arrives. This only runs
  // on the first populated load so a rescan never interrupts playback.
  useEffect(() => {
    if (seededRef.current || !library.ready || library.recent.length === 0) return;
    seededRef.current = true;
    setCurrentTrackId((current) => current ?? library.recent[0].id);
    setQueueIds((current) => (current.length > 0 ? current : library.recent.map((t) => t.id)));
  }, [library.ready, library.recent]);

  // Initialize the audio engine once.
  useEffect(() => {
    const engine = new WavenAudioEngine({
      onTimeUpdate: (time, dur) => {
        setCurrentTime(time);
        setDuration(dur);
      },
      onEnded: () => {
        handleNextRef.current();
      },
      onMetadata: (seconds) => {
        const id = loadedTrackIdRef.current;
        if (id !== null) void libraryRef.current.reportDuration(id, seconds);
      },
      onError: (message) => {
        setNotice(message);
        setIsPlaying(false);
      },
    });
    engineRef.current = engine;

    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  // Load the selected track into the engine without starting playback. When the
  // user presses play explicitly the same track resumes from the beginning.
  useEffect(() => {
    if (!currentTrack) return;
    if (loadedTrackIdRef.current === currentTrack.id) return;
    loadedTrackIdRef.current = currentTrack.id;
    setCurrentTime(0);
    setDuration(currentTrack.durationSec > 0 ? currentTrack.durationSec : 0);
    engineRef.current?.loadTrack(currentTrack, 0, false);
  }, [currentTrack]);

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
    // A completed scan is an external event; this effect mirrors it into the
    // toast queue rather than deriving render state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNotice(message);
  }, [lastScan]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 6500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const startTrack = useCallback(
    (track: Track, autoplay: boolean) => {
      setCurrentTrackId(track.id);
      loadedTrackIdRef.current = track.id;
      setCurrentTime(0);
      setDuration(track.durationSec > 0 ? track.durationSec : 0);
      setIsPlaying(autoplay);
      engineRef.current?.loadTrack(track, 0, autoplay);
    },
    []
  );

  const resolveTrack = useCallback(
    (id: number): Track | undefined => library.resolveTrack(id),
    [library]
  );

  const playTrack = useCallback(
    (track: Track, customQueue?: Track[]) => {
      if (customQueue && customQueue.length > 0) {
        setQueueIds(customQueue.map((entry) => entry.id));
      } else {
        setQueueIds((prev) => (prev.includes(track.id) ? prev : [...prev, track.id]));
      }

      if (track.id === currentTrackId) {
        if (isPlaying) {
          engineRef.current?.pause();
          setIsPlaying(false);
        } else {
          setIsPlaying(true);
          void engineRef.current?.play();
        }
        return;
      }

      startTrack(track, true);
    },
    [currentTrackId, isPlaying, startTrack]
  );

  const handleTogglePlay = useCallback(() => {
    if (!currentTrack || !engineRef.current) return;
    if (isPlaying) {
      engineRef.current.pause();
      setIsPlaying(false);
    } else {
      setIsPlaying(true);
      void engineRef.current.play();
    }
  }, [currentTrack, isPlaying]);

  const playById = useCallback(
    (id: number) => {
      const track = resolveTrack(id);
      if (track) {
        startTrack(track, true);
      } else {
        void library.getTrack(id).then((loaded) => {
          if (loaded) startTrack(loaded, true);
        });
      }
    },
    [library, resolveTrack, startTrack]
  );

  const handleNext = useCallback(() => {
    if (currentTrackId === null) return;
    const nextId = getNextTrackId({
      queueIds,
      currentTrackId,
      shuffle,
      repeat,
    });
    if (nextId === null) {
      // A finished non-looping queue stops cleanly.
      setIsPlaying(false);
      return;
    }
    playById(nextId);
  }, [queueIds, currentTrackId, shuffle, repeat, playById]);

  useEffect(() => {
    handleNextRef.current = handleNext;
  }, [handleNext]);

  const handlePrev = useCallback(() => {
    if (currentTrackId === null) return;
    if (currentTime > 3) {
      engineRef.current?.seek(0);
      setCurrentTime(0);
      return;
    }
    const prevId = getPrevTrackId({ queueIds, currentTrackId });
    if (prevId !== null) playById(prevId);
  }, [currentTime, queueIds, currentTrackId, playById]);

  const handleSeek = useCallback((sec: number) => {
    engineRef.current?.seek(sec);
    setCurrentTime(sec);
  }, []);

  const handleVolumeChange = useCallback((vol: number) => {
    setVolume(vol);
    const nextMuted = vol === 0;
    setMuted(nextMuted);
    engineRef.current?.setMuted(nextMuted);
    engineRef.current?.setVolume(vol);
  }, []);

  const handleToggleMute = useCallback(() => {
    setMuted((currentMuted) => {
      const nextMuted = !currentMuted;
      engineRef.current?.setMuted(nextMuted);
      return nextMuted;
    });
  }, []);

  const handleToggleLike = useCallback(
    (trackId: number) => {
      void library.toggleLike(trackId);
    },
    [library]
  );

  const handleCycleRepeat = useCallback(() => {
    setRepeat((prev) => (prev === 'off' ? 'all' : prev === 'all' ? 'one' : 'off'));
  }, []);

  const handleAddToQueue = useCallback((track: Track) => {
    setQueueIds((prev) => (prev.includes(track.id) ? prev : [...prev, track.id]));
  }, []);

  const handleRemoveFromQueue = useCallback((trackId: number) => {
    setQueueIds((prev) => prev.filter((id) => id !== trackId));
  }, []);

  const handleAddToPlaylist = useCallback((playlistId: string, trackId: number) => {
    setPlaylists((prev) => addTrackToPlaylist(prev, playlistId, trackId));
  }, []);

  const handleRemoveFromPlaylist = useCallback((playlistId: string, trackId: number) => {
    setPlaylists((prev) => removeTrackFromPlaylist(prev, playlistId, trackId));
  }, []);

  const handleCreatePlaylist = useCallback(
    (name: string, description: string) => {
      const newPlaylist: Playlist = {
        id: `pl-${Date.now()}`,
        name,
        description,
        trackIds: currentTrack ? [currentTrack.id] : [],
        coverSrc: currentTrack?.coverSrc ?? '',
        createdAt: Date.now(),
      };
      setPlaylists((prev) => [newPlaylist, ...prev]);
    },
    [currentTrack]
  );

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
        handleNext();
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

  const featuredTracks = useMemo(() => library.recent.slice(0, 3), [library.recent]);
  const isCurrentLiked =
    currentTrack !== null && (library.likes.has(currentTrack.id) || currentTrack.liked);

  const showDiscoverEmpty = library.ready && library.recent.length === 0;

  return (
    <div
      data-window-mode={windowMode}
      className="waven-app relative min-h-screen w-full flex items-center justify-center px-3 py-4 sm:px-6 lg:px-10 pb-24 lg:pb-10 overflow-x-hidden"
    >
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
            <DesktopControls mode={windowMode} onModeChange={setWindowModePreference} />
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
                onNext={handleNext}
                onSeek={handleSeek}
                onToggleLike={handleToggleLike}
                onToggleShuffle={() => setShuffle((current) => !current)}
                onCycleRepeat={handleCycleRepeat}
                onVolumeChange={handleVolumeChange}
                onToggleMute={handleToggleMute}
                onAddToPlaylist={handleAddToPlaylist}
                onOpenQueue={() => setDockSection('library')}
                onOpenLibrary={() => setDockSection('library')}
              />
            </div>
          </div>

          {(library.error || notice) && (
            <div className="mt-4 flex flex-col gap-2">
              {library.error && (
                <div className="flex items-center justify-between gap-3 rounded-2xl border border-rose-400/25 bg-rose-500/10 px-4 py-2.5 text-xs text-rose-100">
                  <span className="flex items-center gap-2 min-w-0">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span className="truncate">{library.error}</span>
                  </span>
                  <button
                    type="button"
                    aria-label="Dismiss error"
                    onClick={library.clearError}
                    className="shrink-0 text-rose-100/70 hover:text-white"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}
              {notice && (
                <div
                  role="status"
                  className="flex items-center justify-between gap-3 rounded-2xl border border-white/12 bg-white/[0.08] px-4 py-2.5 text-xs text-white/85"
                >
                  <span className="truncate">{notice}</span>
                  <button
                    type="button"
                    aria-label="Dismiss message"
                    onClick={() => setNotice(null)}
                    className="shrink-0 text-white/60 hover:text-white"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          )}
        </motion.main>
      </div>
    </div>
  );
}
