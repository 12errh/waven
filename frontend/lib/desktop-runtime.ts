'use client';

type RuntimeModule = typeof import('@wailsio/runtime');

let runtimePromise: Promise<RuntimeModule> | null = null;

/**
 * Loads the Wails JS runtime once per page.
 *
 * Importing the runtime announces `wails:runtime:ready` to the Go shell. The
 * shell needs that handshake before it can run JavaScript in the page, and the
 * runtime also installs the window-drag and window-control bridges.
 *
 * Returns null while server rendering, where there is no window to control.
 */
export function loadDesktopRuntime(): Promise<RuntimeModule> | null {
  if (typeof window === 'undefined') return null;
  runtimePromise ??= import('@wailsio/runtime');
  return runtimePromise;
}

/**
 * Runs a native window action through the Wails runtime. A browser preview has
 * no native window, so a missing runtime is treated as a no-op.
 */
export async function runWindowAction(
  action: 'minimise' | 'maximise' | 'close'
): Promise<void> {
  const runtimePromise = loadDesktopRuntime();
  if (!runtimePromise) return;

  try {
    const { Window } = await runtimePromise;
    if (action === 'minimise') {
      await Window.Minimise();
      return;
    }
    if (action === 'maximise') {
      await Window.ToggleMaximise();
      return;
    }
    // The Go shell intercepts WindowClosing and hides to the tray instead of
    // exiting, so this is the same path the OS close shortcut will take.
    await Window.Close();
  } catch {
    // Browser preview: there is no native window to control.
  }
}
