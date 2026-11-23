import { MotionConfig } from 'motion/react';
import { ToastProvider } from '@/components/ToastStack';
import { WindowRoot } from '@/components/WindowRoot';

export default function HomePage() {
  return (
    // `reducedMotion="user"` makes every motion animation honour the OS setting:
    // transforms and opacity snap to their end state instead of animating.
    <MotionConfig reducedMotion="user">
      <ToastProvider>
        <WindowRoot />
      </ToastProvider>
    </MotionConfig>
  );
}
