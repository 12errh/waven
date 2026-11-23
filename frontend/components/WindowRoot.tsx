'use client';

import { useEffect, useState } from 'react';
import { MiniWindow } from './MiniWindow';
import { WavenPlayer } from './WavenPlayer';

type Shell = 'pending' | 'full' | 'mini';

/**
 * The desktop shell opens two windows from the same exported page. The compact
 * webview loads `/?window=mini` and only mounts the compact UI; the full window
 * keeps the player engine, library, and every playback ref alive behind it.
 *
 * The first client render is deliberately shell-agnostic so the static HTML
 * hydrates identically in both windows before the query param is read.
 */
export function WindowRoot() {
  const [shell, setShell] = useState<Shell>('pending');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setShell(params.get('window') === 'mini' ? 'mini' : 'full');
  }, []);

  if (shell === 'mini') return <MiniWindow />;
  if (shell === 'full') return <WavenPlayer />;
  return <div className="h-dvh w-full bg-[#07080b]" aria-hidden="true" />;
}
