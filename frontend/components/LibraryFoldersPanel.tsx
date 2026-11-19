'use client';

import { FolderOpen, FolderPlus, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/player-logic';
import type { LibraryController } from '@/lib/use-library';

interface LibraryFoldersPanelProps {
  library: LibraryController;
  /** Settings uses a tighter heading; the Library tab keeps its title. */
  compact?: boolean;
}

/**
 * Folder add/remove/rescan controls shared by the Library tab and Settings.
 * Scans run in place; removing a folder only drops its index rows.
 */
export function LibraryFoldersPanel({ library, compact = false }: LibraryFoldersPanelProps) {
  const progress = library.scan.progress;
  const progressPct =
    progress.total > 0 ? Math.min(100, (progress.done / progress.total) * 100) : 0;
  const last = library.scan.last;

  return (
    <div className="rounded-[24px] bg-white/[0.05] border border-white/[0.11] p-4 space-y-3.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-base font-semibold text-white">
            {compact ? 'Library folders' : 'Your Music Library'}
          </h2>
          <p className="text-xs text-white/55 mt-0.5">
            {library.stats.tracks.toLocaleString()} tracks · {library.stats.folders}{' '}
            {library.stats.folders === 1 ? 'folder' : 'folders'} · Last scan{' '}
            {formatRelativeTime(library.stats.lastScanAt)}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            disabled={library.scan.running}
            onClick={() => void library.rescan(0)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-40 disabled:hover:bg-white/10 border border-white/15 text-xs font-medium text-white transition-colors whitespace-nowrap"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', library.scan.running && 'animate-spin')} />
            <span>Rescan all</span>
          </button>
          <button
            type="button"
            disabled={library.scan.running}
            onClick={() => void library.addFolder()}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-white text-[#0a0c12] hover:bg-white/90 disabled:opacity-40 text-xs font-semibold transition-colors whitespace-nowrap"
          >
            <FolderPlus className="w-3.5 h-3.5" />
            <span>Add folder</span>
          </button>
        </div>
      </div>

      {library.scan.running && (
        <div className="rounded-2xl bg-white/[0.05] border border-white/10 px-3.5 py-3">
          <div className="flex items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-xs text-white/85 min-w-0">
              <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
              <span className="truncate">
                {progress.phase === 'discovering'
                  ? 'Finding audio files'
                  : `Scanning ${progress.folderPath || 'library'}`}
              </span>
            </p>
            <span className="font-mono-tabular text-[11px] text-white/60 shrink-0">
              {progress.total > 0 ? `${progress.done} / ${progress.total}` : 'Preparing'}
            </span>
            <button
              type="button"
              onClick={() => void library.cancelScan()}
              className="px-3 py-1 rounded-full bg-white/10 hover:bg-white/20 border border-white/15 text-[11px] text-white shrink-0"
            >
              Cancel
            </button>
          </div>
          <div className="mt-2.5 h-1 rounded-full bg-white/15 overflow-hidden">
            <div
              className="h-full bg-white/80 rounded-full transition-[width] duration-300"
              style={{ width: progress.total > 0 ? `${progressPct}%` : '12%' }}
            />
          </div>
          {progress.currentPath && (
            <p className="mt-1.5 text-[10px] text-white/40 truncate">{progress.currentPath}</p>
          )}
        </div>
      )}

      {last && !library.scan.running && (
        <p className="text-[11px] text-white/50">
          {last.canceled ? 'Cancelled' : 'Last scan'} — {last.added} added, {last.updated}{' '}
          updated, {last.skipped} unchanged
          {last.missing > 0 ? `, ${last.missing} missing` : ''}
          {last.errors.length > 0 ? `, ${last.errors.length} skipped` : ''}
        </p>
      )}

      <div className="space-y-1.5">
        {library.folders.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/15 px-4 py-6 text-center">
            <FolderOpen className="w-6 h-6 text-white/40 mx-auto mb-2" />
            <p className="text-xs text-white/60">
              No music folders yet. Add one and WAVEN will scan it in place.
            </p>
          </div>
        ) : (
          library.folders.map((folder) => (
            <div
              key={folder.id}
              className="flex items-center gap-3 rounded-2xl bg-white/[0.04] border border-white/[0.07] px-3 py-2.5"
            >
              <FolderOpen className="w-4 h-4 text-white/55 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-white/85 truncate" title={folder.path}>
                  {folder.path}
                </p>
                <p className="text-[10px] text-white/40">
                  Scanned {formatRelativeTime(folder.lastScanAt ?? 0)}
                </p>
              </div>
              <button
                type="button"
                disabled={library.scan.running}
                onClick={() => void library.rescan(folder.id)}
                aria-label={`Rescan ${folder.path}`}
                title="Rescan folder"
                className="w-8 h-8 rounded-full text-white/55 hover:text-white hover:bg-white/10 disabled:opacity-30 flex items-center justify-center"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                disabled={library.scan.running}
                onClick={() => {
                  if (
                    window.confirm(
                      `Remove "${folder.path}" and its tracks from WAVEN? The files on disk are not deleted.`
                    )
                  ) {
                    void library.removeFolder(folder.id);
                  }
                }}
                aria-label={`Remove ${folder.path}`}
                title="Remove folder from library"
                className="w-8 h-8 rounded-full text-white/55 hover:text-rose-200 hover:bg-rose-500/10 disabled:opacity-30 flex items-center justify-center"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))
        )}
      </div>

      {library.preview && (
        <p className="text-[10px] text-amber-100/60">
          Browser preview: folder scanning runs against sample data. Open the desktop app to
          scan real files.
        </p>
      )}
    </div>
  );
}
