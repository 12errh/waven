'use client';

import {
  ChevronsDown,
  ChevronsLeft,
  ChevronsRight,
  ChevronsUp,
  Heart,
  Home,
  Music2,
  Search,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DockSection } from '@/lib/types';
import { CATALOG_IMAGES } from '@/lib/catalog-images';
import { CoverImage } from './CoverImage';

interface DockProps {
  activeSection: DockSection;
  onSelectSection: (section: DockSection) => void;
  likedCount: number;
}

interface ExpandableDockProps extends DockProps {
  expanded: boolean;
  onToggleExpanded: () => void;
}

interface NavItem {
  id: DockSection;
  label: string;
  shortLabel: string;
  icon: typeof Home;
}

function navItems(likedCount: number): NavItem[] {
  return [
    { id: 'home', label: 'Home', shortLabel: 'Home', icon: Home },
    { id: 'search', label: 'Search music', shortLabel: 'Search', icon: Search },
    { id: 'library', label: 'Music library and folders', shortLabel: 'Library', icon: Music2 },
    {
      id: 'likes',
      label: `Liked songs (${likedCount})`,
      shortLabel: 'Liked',
      icon: Heart,
    },
  ];
}

/** Desktop vertical dock. It can sit on either side of the shell. */
export function LeftDock({
  activeSection,
  onSelectSection,
  likedCount,
  expanded,
  onToggleExpanded,
  side = 'left',
}: ExpandableDockProps & { side?: 'left' | 'right' }) {
  const items = navItems(likedCount);
  const CollapseIcon = side === 'left' ? ChevronsLeft : ChevronsRight;
  const ExpandIcon = side === 'left' ? ChevronsRight : ChevronsLeft;

  return (
    <nav
      aria-label="Primary player navigation"
      className={cn(
        'hidden lg:flex flex-col py-4 px-2 rounded-full bg-white/[0.06] backdrop-blur-2xl border border-white/[0.12] shadow-[0_24px_60px_rgba(0,0,0,0.65)] shrink-0 gap-3 transition-[width] duration-200',
        expanded ? 'w-[196px] items-stretch' : 'w-[62px] items-center'
      )}
    >
      <div
        className={cn(
          'flex flex-col gap-2.5 w-full',
          expanded ? 'items-stretch' : 'items-center'
        )}
      >
        {items.map((item) => {
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
                'relative h-11 rounded-full flex items-center transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60',
                expanded ? 'w-full justify-start gap-3 px-3' : 'w-11 justify-center',
                isActive
                  ? 'bg-white/[0.16] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.22)]'
                  : 'text-white/60 hover:text-white hover:bg-white/[0.08]'
              )}
            >
              <Icon
                className={cn(
                  'w-[19px] h-[19px] shrink-0',
                  isActive && item.id === 'likes' && 'fill-white'
                )}
                strokeWidth={1.85}
              />
              {expanded && (
                <span className="truncate text-xs font-medium">{item.shortLabel}</span>
              )}
              {expanded && item.id === 'likes' && likedCount > 0 && (
                <span className="ml-auto rounded-full bg-white/12 px-1.5 py-0.5 text-[10px] text-white/65">
                  {likedCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div
        className={cn(
          'mt-auto pt-3 flex gap-2 w-full',
          expanded ? 'items-center' : 'flex-col items-center'
        )}
      >
        <button
          type="button"
          aria-label="Listener profile and settings"
          aria-current={activeSection === 'profile' ? 'page' : undefined}
          title="Listener profile and settings"
          onClick={() => onSelectSection('profile')}
          className={cn(
            'rounded-full overflow-hidden transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60',
            expanded
              ? 'flex min-w-0 flex-1 items-center gap-2.5 px-1 py-1 text-left hover:bg-white/[0.06]'
              : 'w-11 h-11 p-0.5',
            activeSection === 'profile'
              ? 'ring-2 ring-white shadow-lg'
              : 'ring-1 ring-white/25 hover:ring-white/60'
          )}
        >
          <CoverImage
            src={CATALOG_IMAGES.avatar}
            alt="Listener profile avatar"
            className="w-9 h-9 shrink-0 rounded-full object-cover"
          />
          {expanded && (
            <span className="min-w-0">
              <span className="block truncate text-xs font-medium text-white">
                Studio Listener
              </span>
              <span className="block text-[10px] text-white/45">Profile &amp; settings</span>
            </span>
          )}
        </button>
        <button
          type="button"
          aria-label={expanded ? 'Collapse side navigation' : 'Expand side navigation'}
          title={expanded ? 'Collapse side navigation' : 'Expand side navigation'}
          onClick={onToggleExpanded}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-white/60 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
        >
          {expanded ? (
            <CollapseIcon className="h-3.5 w-3.5" />
          ) : (
            <ExpandIcon className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
    </nav>
  );
}

/** Desktop horizontal dock used when the user places navigation at the bottom. */
export function BottomDock({
  activeSection,
  onSelectSection,
  likedCount,
  expanded,
  onToggleExpanded,
}: ExpandableDockProps) {
  const items = navItems(likedCount);

  return (
    <nav
      aria-label="Primary player navigation"
      className="hidden lg:flex w-full items-center justify-center gap-1.5 rounded-full bg-white/[0.06] backdrop-blur-2xl border border-white/[0.12] shadow-[0_24px_60px_rgba(0,0,0,0.65)] px-3 py-2"
    >
      {items.map((item) => {
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
              'relative h-10 rounded-full flex items-center transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60',
              expanded ? 'gap-2 px-3' : 'w-10 justify-center',
              isActive
                ? 'bg-white/[0.16] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.22)]'
                : 'text-white/60 hover:text-white hover:bg-white/[0.08]'
            )}
          >
            <Icon
              className={cn(
                'w-[18px] h-[18px] shrink-0',
                isActive && item.id === 'likes' && 'fill-white'
              )}
              strokeWidth={1.85}
            />
            {expanded && <span className="text-xs font-medium">{item.shortLabel}</span>}
            {expanded && item.id === 'likes' && likedCount > 0 && (
              <span className="rounded-full bg-white/12 px-1.5 py-0.5 text-[10px] text-white/65">
                {likedCount}
              </span>
            )}
          </button>
        );
      })}

      <span aria-hidden="true" className="mx-1 h-6 w-px bg-white/10" />

      <button
        type="button"
        aria-label="Listener profile and settings"
        aria-current={activeSection === 'profile' ? 'page' : undefined}
        title="Listener profile and settings"
        onClick={() => onSelectSection('profile')}
        className={cn(
          'flex h-10 items-center rounded-full transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60',
          expanded ? 'gap-2 px-1.5' : 'w-10 justify-center',
          activeSection === 'profile'
            ? 'ring-2 ring-white'
            : 'ring-1 ring-white/25 hover:ring-white/60'
        )}
      >
        <CoverImage
          src={CATALOG_IMAGES.avatar}
          alt="Listener profile avatar"
          className="h-8 w-8 rounded-full object-cover"
        />
        {expanded && <span className="text-xs font-medium">Profile</span>}
      </button>

      <button
        type="button"
        aria-label={expanded ? 'Hide navigation labels' : 'Show navigation labels'}
        title={expanded ? 'Hide navigation labels' : 'Show navigation labels'}
        onClick={onToggleExpanded}
        className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-white/60 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
      >
        {expanded ? (
          <ChevronsDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronsUp className="h-3.5 w-3.5" />
        )}
      </button>
    </nav>
  );
}

/** Compact fixed dock for narrow screens. It always sits at the bottom. */
export function MobileDock({ activeSection, onSelectSection, likedCount }: DockProps) {
  const items = navItems(likedCount);

  return (
    <nav
      aria-label="Mobile player navigation"
      className="lg:hidden fixed bottom-3 left-3 right-3 z-40 h-14 px-2 rounded-full bg-[#12141b]/90 backdrop-blur-2xl border border-white/[0.14] shadow-[0_16px_40px_rgba(0,0,0,0.7)] flex items-center justify-around"
    >
      {items.map((item) => {
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
  );
}
