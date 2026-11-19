'use client';

import { useState } from 'react';
import { Disc3 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CoverImageProps {
  src: string;
  alt: string;
  className?: string;
  fallbackSrc?: string;
}

export function CoverImage({ src, alt, className, fallbackSrc }: CoverImageProps) {
  // Track failures by URL rather than with a boolean so a component reused for
  // a new track starts from a clean slate without a state-resetting effect.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [failedFallbackSrc, setFailedFallbackSrc] = useState<string | null>(null);

  const primaryFailed = src !== '' && failedSrc === src;
  const fallbackFailed = fallbackSrc !== undefined && failedFallbackSrc === fallbackSrc;
  const activeSrc = primaryFailed
    ? !fallbackSrc || fallbackFailed
      ? ''
      : fallbackSrc
    : src;

  if (activeSrc === '') {
    return (
      <div
        className={cn(
          'flex items-center justify-center bg-gradient-to-br from-slate-800 via-zinc-900 to-black text-white/40',
          className
        )}
        aria-label={alt}
      >
        <Disc3 className="w-1/3 h-1/3" />
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={activeSrc}
      alt={alt}
      referrerPolicy="no-referrer"
      className={className}
      onError={() => {
        if (activeSrc === fallbackSrc) {
          setFailedFallbackSrc(activeSrc);
        } else {
          setFailedSrc(activeSrc);
        }
      }}
    />
  );
}
