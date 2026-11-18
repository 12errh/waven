'use client';

import { Heart, Home, Music2, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DockSection } from '@/lib/types';
import { CATALOG_IMAGES } from '@/lib/catalog-images';
import { CoverImage } from './CoverImage';

interface LeftDockProps {
  activeSection: DockSection;
  onSelectSection: (section: DockSection) => void;
  likedCount: number;
}

export function LeftDock({ activeSection, onSelectSection, likedCount }: LeftDockProps) {
  const navItems: Array<{
    id: DockSection;
    label: string;
    icon: typeof Home;
    badge?: number;
  }> = [
    { id: 'home', label: 'Home', icon: Home },
    { id: 'search', label: 'Search music', icon: Search },
    { id: 'library', label: 'Music library and uploads', icon: Music2 },
    { id: 'likes', label: `Liked songs (${likedCount})`, icon: Heart },
  ];

  return (
    <>
      {/* Desktop Detached Floating Vertical Pill Dock */}
      <nav
        aria-label="Primary player navigation"
        className="hidden lg:flex flex-col items-center justify-between w-[62px] py-4 px-2 rounded-full bg-white/[0.06] backdrop-blur-2xl border border-white/[0.12] shadow-[0_24px_60px_rgba(0,0,0,0.65)] shrink-0 gap-3"
      >
        <div className="flex flex-col items-center gap-2.5">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                aria-label={item.label}
                aria-current={isActive ? 'page' : undefined}
                title={item.label}
                onClick={() => onSelectSection(item.id)}
                className={cn(
                  'relative w-11 h-11 rounded-full flex items-center justify-center transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60',
                  isActive
                    ? 'bg-white/[0.16] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.22)]'
                    : 'text-white/60 hover:text-white hover:bg-white/[0.08]'
                )}
              >
                <Icon
                  className={cn('w-[19px] h-[19px]', isActive && item.id === 'likes' && 'fill-white')}
                  strokeWidth={1.85}
                />
              </button>
            );
          })}
        </div>

        <button
          type="button"
          aria-label="Listener profile and settings"
          aria-current={activeSection === 'profile' ? 'page' : undefined}
          title="Listener profile and settings"
          onClick={() => onSelectSection('profile')}
          className={cn(
            'mt-2 w-11 h-11 rounded-full overflow-hidden p-0.5 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60',
            activeSection === 'profile'
              ? 'ring-2 ring-white shadow-lg'
              : 'ring-1 ring-white/25 hover:ring-white/60'
          )}
        >
          <CoverImage
            src={CATALOG_IMAGES.avatar}
            alt="Listener profile avatar"
            className="w-full h-full rounded-full object-cover"
          />
        </button>
      </nav>

      {/* Mobile Compact Bottom Thumb-Zone Dock (<= 15% height) */}
      <nav
        aria-label="Mobile player navigation"
        className="lg:hidden fixed bottom-3 left-3 right-3 z-40 h-14 px-2 rounded-full bg-[#12141b]/90 backdrop-blur-2xl border border-white/[0.14] shadow-[0_16px_40px_rgba(0,0,0,0.7)] flex items-center justify-around"
      >
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeSection === item.id;
          return (
            <button
              key={item.id}
              type="button"
              aria-label={item.label}
              aria-current={isActive ? 'page' : undefined}
              onClick={() => onSelectSection(item.id)}
              className={cn(
                'w-11 h-11 rounded-full flex items-center justify-center transition-colors',
                isActive ? 'bg-white/[0.16] text-white' : 'text-white/60 hover:text-white'
              )}
            >
              <Icon
                className={cn('w-5 h-5', isActive && item.id === 'likes' && 'fill-white')}
                strokeWidth={1.85}
              />
            </button>
          );
        })}
        <button
          type="button"
          aria-label="Listener profile and settings"
          aria-current={activeSection === 'profile' ? 'page' : undefined}
          onClick={() => onSelectSection('profile')}
          className={cn(
            'w-10 h-10 rounded-full overflow-hidden ring-1 transition-all',
            activeSection === 'profile' ? 'ring-2 ring-white' : 'ring-white/30'
          )}
        >
          <CoverImage
            src={CATALOG_IMAGES.avatar}
            alt="Listener profile avatar"
            className="w-full h-full rounded-full object-cover"
          />
        </button>
      </nav>
    </>
  );
}
