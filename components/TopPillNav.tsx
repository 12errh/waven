'use client';

import { cn } from '@/lib/utils';
import type { TopTab } from '@/lib/types';

const TABS: TopTab[] = ['Discover', 'Playlists', 'Artists', 'Albums', 'Genres'];

interface TopPillNavProps {
  activeTab: TopTab;
  onSelectTab: (tab: TopTab) => void;
}

export function TopPillNav({ activeTab, onSelectTab }: TopPillNavProps) {
  return (
    <div
      role="tablist"
      aria-label="Music catalog categories"
      className="flex items-center justify-between sm:justify-center gap-0.5 sm:gap-1.5 px-1.5 sm:px-2 py-1 sm:py-1.5 rounded-full bg-[#191b22]/85 backdrop-blur-2xl border border-white/[0.12] shadow-[0_18px_45px_rgba(0,0,0,0.65)] overflow-x-auto waven-scroll max-w-full"
    >
      {TABS.map((tab) => {
        const isActive = activeTab === tab;
        return (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelectTab(tab)}
            className={cn(
              'px-2.5 sm:px-5 py-1.5 sm:py-2 rounded-full text-[11px] sm:text-[13px] font-medium transition-all duration-200 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50',
              isActive
                ? 'bg-white/[0.12] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]'
                : 'text-white/60 hover:text-white hover:bg-white/[0.05]'
            )}
          >
            {tab}
          </button>
        );
      })}
    </div>
  );
}
