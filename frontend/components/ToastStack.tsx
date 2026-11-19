'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ToastTone = 'info' | 'success' | 'error';

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

interface ToastApi {
  notify: (message: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** Access the app-wide toast queue. A no-op is safe outside the provider. */
export function useToast(): ToastApi {
  return useContext(ToastContext) ?? { notify: () => {} };
}

const TONE_STYLES: Record<ToastTone, string> = {
  info: 'border-white/15 bg-[#181b23]/92 text-white/90',
  success: 'border-emerald-300/25 bg-emerald-500/15 text-emerald-50',
  error: 'border-rose-400/30 bg-rose-500/15 text-rose-50',
};

const TONE_ICONS = {
  info: Info,
  success: CheckCircle2,
  error: AlertCircle,
} as const;

/**
 * A small, consistent toast queue shared by library, playlist, scan, and drop
 * feedback. Four toasts are kept at most so a burst of errors cannot cover the
 * player.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextIdRef = useRef(0);
  const timersRef = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const notify = useCallback(
    (message: string, tone: ToastTone = 'info') => {
      const clean = message.trim();
      if (!clean) return;
      const id = ++nextIdRef.current;
      setToasts((current) => [...current.slice(-3), { id, message: clean, tone }]);
      const timer = setTimeout(() => dismiss(id), 6000);
      timersRef.current.set(id, timer);
    },
    [dismiss]
  );

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  const value = useMemo(() => ({ notify }), [notify]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed bottom-4 right-4 z-[80] flex w-[min(92vw,370px)] flex-col gap-2"
      >
        {toasts.map((toast) => {
          const Icon = TONE_ICONS[toast.tone];
          return (
            <div
              key={toast.id}
              role={toast.tone === 'error' ? 'alert' : 'status'}
              className={cn(
                'pointer-events-auto flex items-start gap-2.5 rounded-2xl border px-3.5 py-3 text-xs shadow-[0_18px_45px_rgba(0,0,0,0.6)] backdrop-blur-2xl',
                TONE_STYLES[toast.tone]
              )}
            >
              <Icon className="mt-0.5 h-4 w-4 shrink-0 opacity-85" />
              <p className="min-w-0 flex-1 leading-relaxed">{toast.message}</p>
              <button
                type="button"
                aria-label="Dismiss notification"
                onClick={() => dismiss(toast.id)}
                className="shrink-0 rounded-full p-0.5 opacity-60 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
