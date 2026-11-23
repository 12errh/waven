'use client';

import { useSyncExternalStore } from 'react';
import { MiniWindow } from './MiniWindow';
import { WavenPlayer } from './WavenPlayer';

type Shell = 'pending' | 'full' | 'mini';

/**
 * The desktop shell opens two windows from the same exported page. The compact
 * webview loads `/?window=mini` and only mounts the compact UI; the full window
 * keeps the player engine, library, and every playback ref alive behind it.
 *
 * The shell is chosen synchronously from the URL on the client via
 * useSyncExternalStore. A passive effect cannot be used here: a webview that is
 * hidden while it hydrates may never flush its effects, which left the restored
 * full window stuck on the neutral first paint (a black screen).
 */
function subscribe(): () => void {
  return () => {};
}

function getShellSnapshot(): Shell {
  if (typeof window === 'undefined') return 'full';
  return new URLSearchParams(window.location.search).get('window') === 'mini'
    ? 'mini'
    : 'full';
}

function getServerSnapshot(): Shell {
  // Both windows receive the same static HTML; the client snapshot replaces it
  // immediately after hydration, before any window can be hidden.
  return 'pending';
}

export function WindowRoot() {
  const shell = useSyncExternalStore(subscribe, getShellSnapshot, getServerSnapshot);

  if (shell === 'mini') return <MiniWindow />;
  if (shell === 'full') return <WavenPlayer />;

  return (
    <div className="flex h-dvh w-full items-center justify-center bg-[#07080b]" aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/logo.png"
        alt=""
        className="h-24 w-24 object-contain opacity-90"
      />
    </div>
  );
}
