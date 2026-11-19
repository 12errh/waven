'use client';

import { Events } from '@wailsio/runtime';
import * as Bindings from '@/bindings/waven/internal/desktop/libraryservice';
import { createFixtureApi } from './library-fixtures';
import type {
  AlbumPage,
  ArtistPage,
  Folder,
  Genre,
  LibraryStats,
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
  setLiked(id: number, liked: boolean): Promise<void>;
  getTrack(id: number): Promise<Track>;
  search(query: string, limit: number): Promise<SearchResults>;
  setDuration(id: number, durationMs: number): Promise<void>;
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
    setLiked: (id, liked) => Bindings.SetLiked(id, liked),
    getTrack: (id) => Bindings.GetTrack(id),
    search: (query, limit) => Bindings.Search(query, limit),
    setDuration: (id, durationMs) => Bindings.SetDuration(id, durationMs),
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
