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
  const [failed, setFailed] = useState(false);
  const [usedFallback, setUsedFallback] = useState(false);

  const activeSrc = failed && fallbackSrc && !usedFallback ? fallbackSrc : src;

  if (failed && (!fallbackSrc || usedFallback)) {
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
        if (!failed && fallbackSrc) {
          setFailed(true);
        } else {
          setUsedFallback(true);
          setFailed(true);
        }
      }}
    />
  );
}
