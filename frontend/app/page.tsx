import { ToastProvider } from '@/components/ToastStack';
import { WavenPlayer } from '@/components/WavenPlayer';

export default function HomePage() {
  return (
    <ToastProvider>
      <WavenPlayer />
    </ToastProvider>
  );
}
