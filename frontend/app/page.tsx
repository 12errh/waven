import { MotionConfig } from 'motion/react';
import { ToastProvider } from '@/components/ToastStack';
import { WavenPlayer } from '@/components/WavenPlayer';

export default function HomePage() {
  return (
    // `reducedMotion="user"` makes every motion animation honour the OS setting:
    // transforms and opacity snap to their end state instead of animating.
    <MotionConfig reducedMotion="user">
      <ToastProvider>
        <WavenPlayer />
      </ToastProvider>
    </MotionConfig>
  );
}
