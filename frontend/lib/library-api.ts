'use client';

import { Events } from '@wailsio/runtime';
import * as Bindings from '@/bindings/waven/internal/desktop/libraryservice';
import { createFixtureApi } from './library-fixtures';
import type {
  AlbumPage,
  ArtistPage,
  Folder,
  FolderImportResult,
  Genre,
  LibraryDrop,
  LibraryStats,
  MixKind,
  Playlist,
  PlaylistImport,
  ScanProgress,
  ScanStatus,
  ScanSummary,
  SearchResults,
  Track,
  TrackPage,
  TrackQuery,
} from './types';

/**
 * The narrow library surface used by the interface. Both the Wails bindings and
 * the browser fixture implement it, so views never branch on the runtime.
 */
export interface LibraryApi {
  /** True only for the browser fixture, never for the desktop library. */
  preview: boolean;
  getTracks(query: TrackQuery): Promise<TrackPage>;
  getAlbums(limit: number, offset: number): Promise<AlbumPage>;
  getArtists(limit: number, offset: number): Promise<ArtistPage>;
  getGenres(): Promise<Genre[]>;
  getStats(): Promise<LibraryStats>;
  getFolders(): Promise<Folder[]>;
  pickFolder(): Promise<string>;
  addFolder(path: string): Promise<Folder>;
  removeFolder(id: number): Promise<void>;
  rescan(folderID: number): Promise<void>;
  cancelScan(): Promise<void>;
  scanStatus(): Promise<ScanStatus>;
  getLikedIds(): Promise<number[]>;
  getMix(kind: MixKind, limit: number): Promise<Track[]>;
  setLiked(id: number, liked: boolean): Promise<void>;
  getTrack(id: number): Promise<Track>;
  search(query: string, limit: number): Promise<SearchResults>;
  setDuration(id: number, durationMs: number): Promise<void>;
  getPlaylists(): Promise<Playlist[]>;
  createPlaylist(name: string, trackIds: number[]): Promise<Playlist>;
  renamePlaylist(id: number, name: string): Promise<void>;
  deletePlaylist(id: number): Promise<void>;
  addTrackToPlaylist(id: number, trackId: number): Promise<void>;
  removeFromPlaylist(id: number, trackId: number): Promise<void>;
  reorderPlaylist(id: number, trackIds: number[]): Promise<void>;
  /** One-time migration from the old localStorage playlists. */
  importPlaylists(imports: PlaylistImport[]): Promise<number>;
  /** Register dropped files/folders. The Go shell also calls this on drop. */
  importDroppedPaths(paths: string[]): Promise<FolderImportResult>;
  onLibraryDrop(listener: (drop: LibraryDrop) => void): () => void;
  onScanProgress(listener: (progress: ScanProgress) => void): () => void;
  onScanDone(listener: (summary: ScanSummary) => void): () => void;
}

function createDesktopApi(): LibraryApi {
  return {
    preview: false,
    getTracks: (query: TrackQuery) => Bindings.GetTracks(query),
    getAlbums: (limit, offset) => Bindings.GetAlbums(limit, offset),
    getArtists: (limit, offset) => Bindings.GetArtists(limit, offset),
    getGenres: () => Bindings.GetGenres(),
    getStats: () => Bindings.GetStats(),
    getFolders: () => Bindings.GetFolders(),
    pickFolder: () => Bindings.PickFolder(),
    addFolder: (path) => Bindings.AddFolder(path),
    removeFolder: (id) => Bindings.RemoveFolder(id),
    rescan: (folderID) => Bindings.Rescan(folderID),
    cancelScan: () => Bindings.CancelScan(),
    scanStatus: () => Bindings.ScanStatus(),
    getLikedIds: () => Bindings.GetLikedIDs(),
    getMix: (kind, limit) => Bindings.GetMix(kind, limit),
    setLiked: (id, liked) => Bindings.SetLiked(id, liked),
    getTrack: (id) => Bindings.GetTrack(id),
    search: (query, limit) => Bindings.Search(query, limit),
    setDuration: (id, durationMs) => Bindings.SetDuration(id, durationMs),
    getPlaylists: () => Bindings.GetPlaylists(),
    createPlaylist: (name, trackIds) => Bindings.CreatePlaylist(name, trackIds),
    renamePlaylist: (id, name) => Bindings.RenamePlaylist(id, name),
    deletePlaylist: (id) => Bindings.DeletePlaylist(id),
    addTrackToPlaylist: (id, trackId) => Bindings.AddTrackToPlaylist(id, trackId),
    removeFromPlaylist: (id, trackId) => Bindings.RemoveFromPlaylist(id, trackId),
    reorderPlaylist: (id, trackIds) => Bindings.ReorderPlaylist(id, trackIds),
    importPlaylists: (imports) => Bindings.ImportPlaylists(imports),
    importDroppedPaths: (paths) => Bindings.ImportDroppedPaths(paths),
    onLibraryDrop: (listener) =>
      Events.On('library:drop', (event) => listener(event.data as LibraryDrop)),
    onScanProgress: (listener) =>
      Events.On('scan:progress', (event) => listener(event.data as ScanProgress)),
    onScanDone: (listener) =>
      Events.On('scan:done', (event) => listener(event.data as ScanSummary)),
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

let apiPromise: Promise<LibraryApi> | null = null;

/**
 * Resolves the library once per page. The first call probes the Wails bridge
 * with a cheap binding; a plain browser preview falls back to fixtures.
 */
export function getLibraryApi(): Promise<LibraryApi> {
  apiPromise ??= detectLibrary();
  return apiPromise;
}

async function detectLibrary(): Promise<LibraryApi> {
  if (typeof window === 'undefined') return createFixtureApi();
  try {
    await withTimeout(Bindings.GetFolders(), 3000);
    return createDesktopApi();
  } catch {
    return createFixtureApi();
  }
}
