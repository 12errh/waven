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
import {
  DISCOVER_TRACKLIST_IDS,
  FEATURED_CARD_TRACK_IDS,
  INITIAL_PLAYLISTS,
  INITIAL_TRACKS,
} from '@/lib/catalog-data';
import { CATALOG_IMAGES } from '@/lib/catalog-images';
import { WavenAudioEngine } from '@/lib/audio-engine';
import { loadDesktopRuntime } from '@/lib/desktop-runtime';
import {
  addTrackToPlaylist,
  filterTracksByQuery,
  getNextTrackId,
  getPrevTrackId,
  removeTrackFromPlaylist,
} from '@/lib/player-logic';
import type { DockSection, Playlist, RepeatMode, TopTab, Track } from '@/lib/types';
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
  liked: 'waven_liked_ids_v1',
  playlists: 'waven_playlists_v1',
};

export function WavenPlayer() {
  const [tracks, setTracks] = useState<Track[]>(INITIAL_TRACKS);
  const [playlists, setPlaylists] = useState<Playlist[]>(INITIAL_PLAYLISTS);
  const [likedIds, setLikedIds] = useState<Set<string>>(() => new Set(['track-flowers']));

  const [dockSection, setDockSection] = useState<DockSection>('home');
  const [topTab, setTopTab] = useState<TopTab>('Discover');

  const [currentTrackId, setCurrentTrackId] = useState<string>('track-flowers');
  const [queueIds, setQueueIds] = useState<string[]>(() =>
    INITIAL_TRACKS.map((t) => t.id)
  );
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(43);
  const [duration, setDuration] = useState<number>(192);
  const [shuffle, setShuffle] = useState<boolean>(false);
  const [repeat, setRepeat] = useState<RepeatMode>('all');
  const [volume, setVolume] = useState<number>(0.78);
  const [muted, setMuted] = useState<boolean>(false);

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchResults, setSearchResults] = useState<Track[]>(INITIAL_TRACKS);
  const [searchLoading, setSearchLoading] = useState<boolean>(false);
  const windowMode = useSyncExternalStore(
    subscribeWindowMode,
    getWindowModeSnapshot,
    () => DEFAULT_WINDOW_MODE
  );

  const engineRef = useRef<WavenAudioEngine | null>(null);

  // Hydrate likes and playlists from localStorage asynchronously after mount
  useEffect(() => {
    const id = window.setTimeout(() => {
      try {
        const savedLikes = window.localStorage.getItem(STORAGE_KEYS.liked);
        if (savedLikes) {
          const parsed = JSON.parse(savedLikes) as string[];
          if (Array.isArray(parsed)) setLikedIds(new Set(parsed));
        }
        const savedPlaylists = window.localStorage.getItem(STORAGE_KEYS.playlists);
        if (savedPlaylists) {
          const parsedPl = JSON.parse(savedPlaylists) as Playlist[];
          if (Array.isArray(parsedPl) && parsedPl.length > 0) setPlaylists(parsedPl);
        }
      } catch {
        // ignore storage parse issues
      }
    }, 0);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEYS.liked, JSON.stringify(Array.from(likedIds)));
    } catch {
      // ignore
    }
  }, [likedIds]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEYS.playlists, JSON.stringify(playlists));
    } catch {
      // ignore
    }
  }, [playlists]);

  // Bring up the Wails runtime as soon as the interface mounts. This announces
  // the page to the Go shell, which enables the native drag region and lets the
  // shell drive window controls and desktop diagnostics.
  useEffect(() => {
    void loadDesktopRuntime();
  }, []);

  const currentTrack = useMemo(
    () => tracks.find((t) => t.id === currentTrackId) ?? tracks[0],
    [tracks, currentTrackId]
  );

  // Refs for latest navigation callback inside audio ended handler
  const handleNextRef = useRef<() => void>(() => {});

  // Initialize audio engine once
  useEffect(() => {
    const engine = new WavenAudioEngine({
      onTimeUpdate: (time, dur) => {
        setCurrentTime(time);
        setDuration(dur);
      },
      onEnded: () => {
        handleNextRef.current();
      },
    });
    engine.loadTrack(INITIAL_TRACKS[0], 43, false);
    engineRef.current = engine;

    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  const playTrack = useCallback(
    (track: Track, customQueue?: Track[]) => {
      // Ensure track exists in master tracks list (for search results)
      setTracks((prev) => (prev.some((t) => t.id === track.id) ? prev : [track, ...prev]));

      if (customQueue && customQueue.length > 0) {
        setQueueIds(customQueue.map((t) => t.id));
      } else {
        setQueueIds((prev) => (prev.includes(track.id) ? prev : [...prev, track.id]));
      }

      if (track.id === currentTrackId) {
        if (isPlaying) {
          engineRef.current?.pause();
          setIsPlaying(false);
        } else {
          engineRef.current?.play();
          setIsPlaying(true);
        }
        return;
      }

      setCurrentTrackId(track.id);
      setCurrentTime(0);
      setDuration(track.durationSec);
      setIsPlaying(true);
      engineRef.current?.loadTrack(track, 0, true);
    },
    [currentTrackId, isPlaying]
  );

  const handleTogglePlay = useCallback(() => {
    if (!engineRef.current || !currentTrack) return;
    if (isPlaying) {
      engineRef.current.pause();
      setIsPlaying(false);
    } else {
      engineRef.current.play();
      setIsPlaying(true);
    }
  }, [isPlaying, currentTrack]);

  const handleNext = useCallback(() => {
    const nextId = getNextTrackId({
      queueIds,
      currentTrackId,
      shuffle,
      repeat,
    });
    if (!nextId) return;
    const nextTrack = tracks.find((t) => t.id === nextId);
    if (!nextTrack) return;
    setCurrentTrackId(nextTrack.id);
    setCurrentTime(0);
    setDuration(nextTrack.durationSec);
    setIsPlaying(true);
    engineRef.current?.loadTrack(nextTrack, 0, true);
  }, [queueIds, currentTrackId, shuffle, repeat, tracks]);

  useEffect(() => {
    handleNextRef.current = handleNext;
  }, [handleNext]);

  const handlePrev = useCallback(() => {
    if (currentTime > 3) {
      engineRef.current?.seek(0);
      setCurrentTime(0);
      return;
    }
    const prevId = getPrevTrackId({ queueIds, currentTrackId });
    if (!prevId) return;
    const prevTrack = tracks.find((t) => t.id === prevId);
    if (!prevTrack) return;
    setCurrentTrackId(prevTrack.id);
    setCurrentTime(0);
    setDuration(prevTrack.durationSec);
    setIsPlaying(true);
    engineRef.current?.loadTrack(prevTrack, 0, true);
  }, [currentTime, queueIds, currentTrackId, tracks]);

  const handleSeek = useCallback((sec: number) => {
    engineRef.current?.seek(sec);
    setCurrentTime(sec);
  }, []);

  const handleVolumeChange = useCallback((vol: number) => {
    setVolume(vol);
    setMuted(vol === 0);
    engineRef.current?.setMuted(vol === 0);
    engineRef.current?.setVolume(vol);
  }, []);

  const handleToggleMute = useCallback(() => {
    const nextMuted = !muted;
    setMuted(nextMuted);
    engineRef.current?.setMuted(nextMuted);
  }, [muted]);

  const handleToggleLike = useCallback((trackId: string) => {
    setLikedIds((prev) => {
      const next = new Set(prev);
      const wasLiked = next.has(trackId);
      if (wasLiked) {
        next.delete(trackId);
      } else {
        next.add(trackId);
      }
      // Adjust displayed likes count slightly for immediate tactile feedback
      setTracks((tPrev) =>
        tPrev.map((t) =>
          t.id === trackId
            ? { ...t, likesCount: Math.max(0, t.likesCount + (wasLiked ? -1 : 1)) }
            : t
        )
      );
      return next;
    });
  }, []);

  const handleCycleRepeat = useCallback(() => {
    setRepeat((prev) => (prev === 'off' ? 'all' : prev === 'all' ? 'one' : 'off'));
  }, []);

  const handleAddToQueue = useCallback((track: Track) => {
    setTracks((prev) => (prev.some((t) => t.id === track.id) ? prev : [track, ...prev]));
    setQueueIds((prev) => (prev.includes(track.id) ? prev : [...prev, track.id]));
  }, []);

  const handleRemoveFromQueue = useCallback((trackId: string) => {
    setQueueIds((prev) => prev.filter((id) => id !== trackId));
  }, []);

  const handleAddToPlaylist = useCallback(
    (playlistId: string, trackId: string) => {
      const track = searchResults.find((t) => t.id === trackId) ?? tracks.find((t) => t.id === trackId);
      if (track) {
        setTracks((prev) => (prev.some((t) => t.id === track.id) ? prev : [track, ...prev]));
      }
      setPlaylists((prev) => addTrackToPlaylist(prev, playlistId, trackId));
    },
    [searchResults, tracks]
  );

  const handleRemoveFromPlaylist = useCallback((playlistId: string, trackId: string) => {
    setPlaylists((prev) => removeTrackFromPlaylist(prev, playlistId, trackId));
  }, []);

  const handleCreatePlaylist = useCallback(
    (name: string, description: string) => {
      const newPl: Playlist = {
        id: `pl-${Date.now()}`,
        name,
        description,
        trackIds: currentTrack ? [currentTrack.id] : [],
        coverSrc: currentTrack?.coverSrc || CATALOG_IMAGES.champagne,
        createdAt: Date.now(),
      };
      setPlaylists((prev) => [newPl, ...prev]);
    },
    [currentTrack]
  );

  const handleUploadFiles = useCallback(
    (files: FileList) => {
      const created: Track[] = [];
      Array.from(files).forEach((file, idx) => {
        const blobUrl = URL.createObjectURL(file);
        const cleanName = file.name.replace(/\.[^/.]+$/, '');
        const newTrack: Track = {
          id: `local-${Date.now()}-${idx}`,
          title: cleanName || 'Local Audio',
          artist: 'Local File',
          album: 'Uploaded Library',
          genre: 'Local',
          year: new Date().getFullYear(),
          durationSec: 180,
          coverSrc: CATALOG_IMAGES.motorsport,
          badgeLabel: 'Local audio',
          releaseMeta: 'Uploaded · Audio File',
          likesCount: 1,
          audioUrl: blobUrl,
          isLocalUpload: true,
        };
        created.push(newTrack);
      });
      if (created.length > 0) {
        setTracks((prev) => [...created, ...prev]);
        setQueueIds((prev) => [...created.map((c) => c.id), ...prev]);
        playTrack(created[0]);
      }
    },
    [playTrack]
  );

  const handleAddAudioUrl = useCallback(
    (title: string, artist: string, url: string) => {
      const newTrack: Track = {
        id: `url-${Date.now()}`,
        title,
        artist,
        album: 'Custom Stream',
        genre: 'Stream',
        year: new Date().getFullYear(),
        durationSec: 210,
        coverSrc: CATALOG_IMAGES.technicolor,
        badgeLabel: 'Stream',
        releaseMeta: 'Custom · Direct Audio',
        likesCount: 1,
        audioUrl: url,
      };
      setTracks((prev) => [newTrack, ...prev]);
      setQueueIds((prev) => [newTrack.id, ...prev]);
      playTrack(newTrack);
    },
    [playTrack]
  );

  const handleSearchChange = useCallback(
    (q: string) => {
      setSearchQuery(q);
      const trimmed = q.trim();
      if (!trimmed) {
        setSearchResults(tracks);
        setSearchLoading(false);
        return;
      }
      setSearchResults(filterTracksByQuery(tracks, trimmed));
      setSearchLoading(true);
    },
    [tracks]
  );

  // Debounced search against /api/music/search
  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) return;

    const localImmediate = filterTracksByQuery(tracks, q);
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/music/search?q=${encodeURIComponent(q)}`);
        if (!res.ok) throw new Error('Search failed');
        const data = (await res.json()) as { tracks?: Track[] };
        if (Array.isArray(data.tracks)) {
          const merged = [
            ...localImmediate,
            ...data.tracks.filter((rt) => !localImmediate.some((lt) => lt.id === rt.id)),
          ];
          setSearchResults(merged);
        }
      } catch {
        setSearchResults(localImmediate);
      } finally {
        setSearchLoading(false);
      }
    }, 300);

    return () => window.clearTimeout(timer);
  }, [searchQuery, tracks]);

  // Global keyboard shortcuts (ignore when typing in inputs)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      if (e.code === 'Space') {
        e.preventDefault();
        handleTogglePlay();
      } else if (e.key === 'n' || e.key === 'N') {
        handleNext();
      } else if (e.key === 'p' || e.key === 'P') {
        handlePrev();
      } else if ((e.key === 'l' || e.key === 'L') && currentTrack) {
        handleToggleLike(currentTrack.id);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleTogglePlay, handleNext, handlePrev, handleToggleLike, currentTrack]);

  // Featured cards & Discover tracklist
  const featuredTracks = useMemo(
    () =>
      FEATURED_CARD_TRACK_IDS.map((id) => tracks.find((t) => t.id === id)).filter(
        (t): t is Track => Boolean(t)
      ),
    [tracks]
  );

  const discoverTracklist = useMemo(() => {
    const curated = DISCOVER_TRACKLIST_IDS.map((id) => tracks.find((t) => t.id === id)).filter(
      (t): t is Track => Boolean(t)
    );
    const customUploads = tracks.filter(
      (t) => t.isLocalUpload && !DISCOVER_TRACKLIST_IDS.includes(t.id)
    );
    return [...customUploads, ...curated];
  }, [tracks]);

  const isCurrentLiked = likedIds.has(currentTrack.id);

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
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={currentTrack.coverSrc}
          alt=""
          referrerPolicy="no-referrer"
          className="w-full h-full object-cover opacity-40 blur-[110px] scale-125 transition-all duration-1000"
        />
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
          likedCount={likedIds.size}
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
            <DesktopControls mode={windowMode} onModeChange={setWindowModePreference} />
          </header>

          {/* 2-Column Content Area */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 lg:gap-6 items-stretch">
            {/* Left Workspace Column */}
            <div className="lg:col-span-7 min-w-0 flex flex-col gap-5">
              {dockSection === 'home' && topTab === 'Discover' ? (
                <>
                  <FeaturedCardsRow
                    tracks={featuredTracks}
                    currentTrackId={currentTrack.id}
                    isPlaying={isPlaying}
                    likedIds={likedIds}
                    onPlayTrack={(track) => playTrack(track)}
                    onToggleLike={handleToggleLike}
                  />
                  <TrackListPanel
                    tracks={discoverTracklist}
                    currentTrackId={currentTrack.id}
                    isPlaying={isPlaying}
                    likedIds={likedIds}
                    playlists={playlists}
                    onPlayTrack={(track) => playTrack(track, discoverTracklist)}
                    onToggleLike={handleToggleLike}
                    onAddToQueue={handleAddToQueue}
                    onAddToPlaylist={handleAddToPlaylist}
                  />
                </>
              ) : (
                <SecondaryViews
                  dockSection={dockSection}
                  topTab={topTab}
                  allTracks={tracks}
                  currentTrackId={currentTrack.id}
                  isPlaying={isPlaying}
                  likedIds={likedIds}
                  playlists={playlists}
                  queueIds={queueIds}
                  searchQuery={searchQuery}
                  searchResults={searchQuery.trim() ? searchResults : tracks}
                  searchLoading={searchLoading}
                  volume={volume}
                  onSearchChange={handleSearchChange}
                  onPlayTrack={playTrack}
                  onToggleLike={handleToggleLike}
                  onAddToQueue={handleAddToQueue}
                  onAddToPlaylist={handleAddToPlaylist}
                  onRemoveFromPlaylist={handleRemoveFromPlaylist}
                  onCreatePlaylist={handleCreatePlaylist}
                  onUploadFiles={handleUploadFiles}
                  onAddAudioUrl={handleAddAudioUrl}
                  onRemoveFromQueue={handleRemoveFromQueue}
                  onVolumeChange={handleVolumeChange}
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
                onToggleShuffle={() => setShuffle((s) => !s)}
                onCycleRepeat={handleCycleRepeat}
                onVolumeChange={handleVolumeChange}
                onToggleMute={handleToggleMute}
                onAddToPlaylist={handleAddToPlaylist}
                onOpenQueue={() => setDockSection('library')}
              />
            </div>
          </div>
        </motion.main>
      </div>
    </div>
  );
}
