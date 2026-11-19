'use client';

import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

interface VisualizerProps {
  /** Reads analyser frequency data into the target buffer. */
  read: (target: Uint8Array) => boolean;
  /** When false the bars rest at their idle level. */
  active: boolean;
  bars?: number;
  className?: string;
}

const DEFAULT_BARS = 32;

/**
 * Analyser-driven bar visualizer. React state is never touched per frame: the
 * rAF loop writes transforms directly to the bar elements. Reads stop while the
 * component is off screen or the document is hidden so idle CPU stays low.
 * Reduced-motion users get the resting bars only.
 */
export function Visualizer({ read, active, bars = DEFAULT_BARS, className }: VisualizerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const barRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const visibleRef = useRef(true);
  const reducedRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => {
      reducedRef.current = query.matches;
    };
    apply();
    query.addEventListener('change', apply);
    return () => query.removeEventListener('change', apply);
  }, []);

  useEffect(() => {
    const node = containerRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        visibleRef.current = entries.some((entry) => entry.isIntersecting);
      },
      { threshold: 0 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const paint = (levels: Float32Array) => {
      for (let index = 0; index < levels.length; index += 1) {
        const bar = barRefs.current[index];
        if (!bar) continue;
        bar.style.transform = `scaleY(${Math.max(0.06, Math.min(1, levels[index]))})`;
      }
    };

    const paintIdle = () => {
      const idle = new Float32Array(bars);
      for (let index = 0; index < bars; index += 1) {
        idle[index] = 0.08 + 0.03 * Math.sin(index * 0.9);
      }
      paint(idle);
    };

    if (!active || reducedRef.current) {
      paintIdle();
      return;
    }

    let frame = 0;
    let cancelled = false;
    let lastPaint = 0;
    const data = new Uint8Array(128);
    const smoothed = new Float32Array(bars);

    const tick = (now: number) => {
      if (cancelled) return;
      frame = window.requestAnimationFrame(tick);
      if (document.hidden || !visibleRef.current) return;
      if (now - lastPaint < 50) return;
      lastPaint = now;

      const hasSignal = read(data);
      for (let index = 0; index < bars; index += 1) {
        let level: number;
        if (hasSignal) {
          const ratio = (index + 1) / bars;
          const bin = Math.min(
            data.length - 1,
            Math.max(1, Math.floor(Math.pow(ratio, 1.55) * data.length * 0.62))
          );
          level = Math.min(1, ((data[bin] ?? 0) / 255) * 1.35);
        } else {
          // Before the first gesture there is no analyser; rest quietly.
          level = 0.08 + 0.03 * Math.sin(now / 600 + index * 0.55);
        }
        smoothed[index] += (level - smoothed[index]) * 0.32;
      }
      paint(smoothed);
    };

    frame = window.requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      paintIdle();
    };
  }, [active, bars, read]);

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      className={cn('flex h-full w-full items-end justify-between gap-[3px]', className)}
    >
      {Array.from({ length: bars }, (_, index) => (
        <span
          key={index}
          ref={(node) => {
            barRefs.current[index] = node;
          }}
          className={cn(
            'h-full flex-1 origin-bottom rounded-full bg-gradient-to-t from-white/30 via-white/75 to-white transition-opacity duration-500',
            active ? 'opacity-90' : 'opacity-40'
          )}
          style={{ transform: 'scaleY(0.08)' }}
        />
      ))}
    </div>
  );
}
