'use client';

/**
 * First-paint placeholder for the library screens. It mirrors the featured card
 * strip and the track list so the shell does not jump when real rows arrive.
 * The pulse is disabled by the reduced-motion rule in globals.css.
 */
export function LibrarySkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading your library" className="flex flex-col gap-5">
      <span className="sr-only">Loading your library…</span>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((index) => (
          <div
            key={index}
            className="flex h-[150px] items-center gap-3 rounded-[24px] border border-white/[0.08] bg-white/[0.04] p-4"
          >
            <div className="library-skeleton-block h-20 w-20 shrink-0 rounded-2xl" />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <div className="library-skeleton-block h-3 w-4/5 rounded-full" />
              <div className="library-skeleton-block h-2.5 w-3/5 rounded-full" />
              <div className="library-skeleton-block h-2.5 w-2/5 rounded-full" />
            </div>
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-3 rounded-[24px] border border-white/[0.08] bg-white/[0.03] p-4">
        {[0, 1, 2, 3, 4].map((index) => (
          <div key={index} className="flex items-center gap-3">
            <div className="library-skeleton-block h-9 w-9 shrink-0 rounded-lg" />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <div className="library-skeleton-block h-2.5 w-1/3 rounded-full" />
              <div className="library-skeleton-block h-2 w-1/5 rounded-full" />
            </div>
            <div className="library-skeleton-block h-2 w-10 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
