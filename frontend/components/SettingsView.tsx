'use client';

import type { ReactNode } from 'react';
import {
  AlertTriangle,
  Check,
  Clock3,
  Disc3,
  FolderOpen,
  HardDrive,
  Heart,
  Keyboard,
  LogOut,
  Music2,
  SlidersHorizontal,
  Sparkles,
  Volume2,
} from 'lucide-react';
import { CATALOG_IMAGES } from '@/lib/catalog-images';
import { cn } from '@/lib/utils';
import {
  formatBytes,
  formatLibraryDuration,
  formatRelativeTime,
} from '@/lib/player-logic';
import type { Playlist } from '@/lib/types';
import type { LibraryController } from '@/lib/use-library';
import type { SettingsController } from '@/lib/use-settings';
import { WINDOW_MODE_SWATCHES, WINDOW_MODES } from '@/lib/window-mode';
import { CoverImage } from './CoverImage';
import { LibraryFoldersPanel } from './LibraryFoldersPanel';

interface SettingsViewProps {
  library: LibraryController;
  settings: SettingsController;
  playlists: Playlist[];
  volume: number;
  onVolumeChange: (volume: number) => void;
  onGoDiscover: () => void;
}

function platformLabel(platform: string | undefined): string {
  switch (platform) {
    case 'darwin':
      return 'macOS';
    case 'windows':
      return 'Windows';
    case 'linux':
      return 'Linux';
    case 'web':
      return 'Browser preview';
    default:
      return platform || 'Unknown';
  }
}

function SettingsCard({
  icon: Icon,
  title,
  description,
  action,
  children,
}: {
  icon: typeof Music2;
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[24px] bg-white/[0.045] border border-white/[0.1] p-5 space-y-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/[0.07] border border-white/10">
            <Icon className="h-4 w-4 text-white/70" strokeWidth={1.8} />
          </span>
          <div className="min-w-0">
            <h3 className="font-display text-sm font-semibold text-white">{title}</h3>
            {description && (
              <p className="mt-0.5 text-[11px] leading-relaxed text-white/50">{description}</p>
            )}
          </div>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function SettingToggle({
  label,
  description,
  checked,
  disabled = false,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'flex w-full items-start justify-between gap-4 rounded-2xl border px-3.5 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50',
        checked
          ? 'border-white/20 bg-white/[0.075]'
          : 'border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.055]',
        disabled && 'cursor-not-allowed opacity-45 hover:bg-white/[0.03]'
      )}
    >
      <span className="min-w-0">
        <span className="block text-xs font-medium text-white">{label}</span>
        <span className="mt-0.5 block text-[10px] leading-relaxed text-white/45">
          {description}
        </span>
      </span>
      <span
        aria-hidden="true"
        className={cn(
          'relative mt-0.5 h-5 w-9 shrink-0 rounded-full border transition-colors duration-200',
          checked ? 'border-white/70 bg-white' : 'border-white/20 bg-white/10'
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 left-0.5 h-3.5 w-3.5 rounded-full transition-transform duration-200',
            checked ? 'translate-x-4 bg-[#090b10]' : 'translate-x-0 bg-white/75'
          )}
        />
      </span>
    </button>
  );
}

function InfoRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <span className="text-[11px] text-white/45">{label}</span>
      <span
        className={cn(
          'max-w-[65%] text-right text-[11px] text-white/80',
          mono && 'break-all font-mono-tabular text-[10px]'
        )}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * The Settings destination. It keeps the profile identity and listening stats
 * from the original screen, then adds folder management, appearance, startup,
 * and About controls backed by the Go Settings service.
 */
export function SettingsView({
  library,
  settings,
  playlists,
  volume,
  onVolumeChange,
  onGoDiscover,
}: SettingsViewProps) {
  const prefs = settings.settings;
  const info = settings.info;
  const stats = library.stats;
  const trayAvailable = settings.preview ? true : (info?.trayAvailable ?? true);
  const autostartAvailable = settings.preview ? true : (info?.autostartSupported ?? true);

  const summary: Array<{ label: string; value: string; icon: typeof Music2 }> = [
    { label: 'Tracks', value: stats.tracks.toLocaleString(), icon: Music2 },
    { label: 'Albums', value: stats.albums.toLocaleString(), icon: Disc3 },
    { label: 'Artists', value: stats.artists.toLocaleString(), icon: Heart },
    { label: 'Genres', value: stats.genres.toLocaleString(), icon: Music2 },
    { label: 'Folders', value: stats.folders.toLocaleString(), icon: FolderOpen },
    { label: 'Liked', value: stats.liked.toLocaleString(), icon: Heart },
    { label: 'Listening time', value: formatLibraryDuration(stats.durationMs), icon: Clock3 },
    { label: 'Artwork cache', value: formatBytes(stats.cacheBytes), icon: HardDrive },
  ];

  const trayStatus = settings.preview
    ? 'Browser preview'
    : info
      ? info.trayAvailable
        ? 'Available'
        : 'Unavailable'
      : 'Checking…';
  const autostartStatus = settings.preview
    ? 'Browser preview'
    : info
      ? info.autostartSupported
        ? 'Available'
        : 'Unavailable'
      : 'Checking…';

  return (
    <div className="flex flex-col gap-4 h-full">
      <div className="rounded-[26px] bg-white/[0.05] border border-white/[0.11] p-5 flex flex-wrap items-center gap-4">
        <CoverImage
          src={CATALOG_IMAGES.avatar}
          alt="Listener avatar"
          className="w-16 h-16 rounded-full object-cover ring-2 ring-white/25"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-lg font-bold text-white">Studio Listener</h2>
            <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.06] px-2 py-0.5 text-[9px] uppercase tracking-[0.14em] text-white/55">
              <SlidersHorizontal className="h-2.5 w-2.5" />
              Settings
            </span>
            {settings.saving && (
              <span className="text-[10px] text-white/45" role="status">
                Saving…
              </span>
            )}
          </div>
          <p className="text-xs text-white/60 mt-0.5">
            {stats.tracks.toLocaleString()} Tracks · {stats.liked.toLocaleString()} Liked ·{' '}
            {playlists.length} {playlists.length === 1 ? 'Playlist' : 'Playlists'}
          </p>
          <p className="text-[10px] text-white/40 mt-1">
            Local library · Last scan {formatRelativeTime(stats.lastScanAt)}
            {library.preview ? ' · Browser preview' : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={onGoDiscover}
          className="px-4 py-2 rounded-full bg-white/12 hover:bg-white/20 border border-white/15 text-xs font-medium text-white whitespace-nowrap"
        >
          Back to Discover
        </button>
      </div>

      {settings.error && (
        <div className="flex items-start justify-between gap-3 rounded-2xl border border-rose-400/25 bg-rose-500/10 px-4 py-3 text-xs text-rose-100">
          <span className="flex items-start gap-2 min-w-0">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="min-w-0 break-words">{settings.error}</span>
          </span>
          <button
            type="button"
            onClick={settings.clearError}
            className="shrink-0 rounded-full border border-rose-200/25 px-2.5 py-1 text-[10px] hover:bg-rose-400/15"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {summary.map((item) => {
          const Icon = item.icon;
          return (
            <div
              key={item.label}
              className="rounded-2xl bg-white/[0.045] border border-white/[0.08] px-3 py-2.5"
            >
              <Icon className="w-3.5 h-3.5 text-white/40 mb-1.5" />
              <p className="font-display text-sm font-semibold text-white">{item.value}</p>
              <p className="text-[10px] text-white/45">{item.label}</p>
            </div>
          );
        })}
      </div>

      {stats.missing > 0 && (
        <div className="flex items-start gap-2.5 rounded-2xl border border-amber-300/25 bg-amber-400/10 px-4 py-3 text-xs text-amber-100/85">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <p>
            {stats.missing} {stats.missing === 1 ? 'track is' : 'tracks are'} missing on disk.
            Rescan the library to refresh the index, or remove the affected folder.
          </p>
        </div>
      )}

      <LibraryFoldersPanel library={library} compact />

      <SettingsCard
        icon={Sparkles}
        title="Appearance"
        description="Glass keeps the ambient cover tint. Pure glass lets the desktop show through completely. Solid is the fallback for desktops without compositing."
        action={
          <span className="rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[9px] uppercase tracking-[0.14em] text-white/45">
            {WINDOW_MODES.find((mode) => mode.id === prefs.windowMode)?.label ?? 'Glass'}
          </span>
        }
      >
        <div role="radiogroup" aria-label="Window appearance" className="space-y-1.5">
          {WINDOW_MODES.map((option) => {
            const active = option.id === prefs.windowMode;
            return (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => void settings.update({ windowMode: option.id })}
                className={cn(
                  'flex w-full items-center gap-3 rounded-2xl border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50',
                  active
                    ? 'border-white/25 bg-white/[0.085]'
                    : 'border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.055]'
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'h-8 w-8 shrink-0 rounded-full border shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]',
                    WINDOW_MODE_SWATCHES[option.id]
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-medium text-white">{option.label}</span>
                  <span className="mt-0.5 block text-[10px] leading-relaxed text-white/45">
                    {option.hint}
                  </span>
                </span>
                <span
                  className={cn(
                    'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors',
                    active ? 'border-white bg-white text-[#090b10]' : 'border-white/20'
                  )}
                >
                  {active && <Check className="h-3 w-3" strokeWidth={3} />}
                </span>
              </button>
            );
          })}
        </div>
      </SettingsCard>

      <SettingsCard
        icon={Volume2}
        title="Playback"
        description="Output level and how WAVEN behaves when the window closes or the desktop starts."
      >
        <div className="space-y-2 rounded-2xl border border-white/[0.08] bg-white/[0.03] px-3.5 py-3">
          <div className="flex items-center justify-between text-xs text-white/80">
            <span className="font-medium">Master output volume</span>
            <span className="font-mono-tabular text-white/60">{Math.round(volume * 100)}%</span>
          </div>
          <input
            type="range"
            aria-label="Master output volume"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(event) => onVolumeChange(parseFloat(event.target.value))}
            className="w-full accent-white h-1.5 bg-white/20 rounded-full cursor-pointer"
          />
        </div>

        <div className="space-y-1.5">
          <SettingToggle
            label="Close to tray"
            checked={prefs.closeToTray}
            description={
              trayAvailable
                ? 'Closing the window keeps music playing in the system tray.'
                : 'No system tray host was found on this desktop, so closing still quits WAVEN.'
            }
            onChange={(checked) => void settings.update({ closeToTray: checked })}
          />
          <SettingToggle
            label="Start hidden"
            checked={prefs.startHidden}
            disabled={!trayAvailable}
            description={
              trayAvailable
                ? 'Launch in the tray without showing the window. Playing state is restored.'
                : 'Requires a system tray host.'
            }
            onChange={(checked) => void settings.update({ startHidden: checked })}
          />
          <SettingToggle
            label="Launch at login"
            checked={prefs.autostart}
            disabled={!autostartAvailable}
            description={
              autostartAvailable
                ? prefs.startHidden && prefs.autostart
                  ? 'Starts WAVEN at login, hidden in the tray.'
                  : 'Starts WAVEN automatically when you sign in.'
                : 'Autostart is not available in this build.'
            }
            onChange={(checked) => void settings.update({ autostart: checked })}
          />
        </div>
      </SettingsCard>

      <SettingsCard
        icon={Keyboard}
        title="Keyboard shortcuts"
        description="Playback and navigation stay available while WAVEN is in the tray."
      >
        <div className="grid grid-cols-2 gap-2 text-xs text-white/65">
          <div className="flex items-center justify-between rounded-xl bg-white/[0.04] px-3 py-2">
            <span>Play / Pause</span>
            <kbd className="font-mono-tabular text-white/90">Space</kbd>
          </div>
          <div className="flex items-center justify-between rounded-xl bg-white/[0.04] px-3 py-2">
            <span>Seek 5s</span>
            <kbd className="font-mono-tabular text-white/90">← / →</kbd>
          </div>
          <div className="flex items-center justify-between rounded-xl bg-white/[0.04] px-3 py-2">
            <span>Next / Prev</span>
            <kbd className="font-mono-tabular text-white/90">N / P</kbd>
          </div>
          <div className="flex items-center justify-between rounded-xl bg-white/[0.04] px-3 py-2">
            <span>Like Track</span>
            <kbd className="font-mono-tabular text-white/90">L</kbd>
          </div>
          <div className="flex items-center justify-between rounded-xl bg-white/[0.04] px-3 py-2">
            <span>Search</span>
            <kbd className="font-mono-tabular text-white/90">⌘ / Ctrl F</kbd>
          </div>
          <div className="flex items-center justify-between rounded-xl bg-white/[0.04] px-3 py-2">
            <span>Back Home</span>
            <kbd className="font-mono-tabular text-white/90">Esc</kbd>
          </div>
        </div>
      </SettingsCard>

      <SettingsCard
        icon={HardDrive}
        title="About WAVEN"
        description="Local-first playback. Your library, settings, and playback session stay on this machine."
      >
        <div className="divide-y divide-white/[0.06]">
          <InfoRow label="Version" value={info?.version ?? '…'} />
          <InfoRow label="Platform" value={platformLabel(info?.platform)} />
          <InfoRow label="Settings and library" value={info?.dataDir ?? '…'} mono />
          <InfoRow label="Artwork cache" value={info?.cacheDir ?? '…'} mono />
          <InfoRow label="System tray" value={trayStatus} />
          <InfoRow label="Autostart" value={autostartStatus} />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <p className="text-[10px] leading-relaxed text-white/40">
            {settings.preview
              ? 'Browser preview saves preferences in this tab only.'
              : 'Settings are stored in waven.db inside the data folder above.'}
          </p>
          <button
            type="button"
            disabled={settings.preview}
            onClick={() => void settings.quit()}
            title={settings.preview ? 'Quit is only available in the desktop app' : 'Quit WAVEN'}
            className="inline-flex items-center gap-1.5 rounded-full border border-rose-300/25 bg-rose-500/10 px-3.5 py-2 text-xs font-medium text-rose-100 transition-colors hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <LogOut className="h-3.5 w-3.5" />
            Quit WAVEN
          </button>
        </div>
      </SettingsCard>
    </div>
  );
}
