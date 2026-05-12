'use client';

/**
 * Persistent connectivity banner. Listens to window.online / window.offline
 * events plus an optional WebSocket "connection lost" signal from the
 * dispatch socket gateway.
 *
 * Renders fixed at the top of the viewport with role="status" so screen
 * readers announce the state change but don't trap focus.
 */
import { cn } from '@/lib/utils';
import { WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';

export function ConnectivityBanner(): JSX.Element | null {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setOnline(navigator.onLine);
    const handleOnline = (): void => setOnline(true);
    const handleOffline = (): void => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (online) return null;

  return (
    <output
      aria-live="polite"
      className={cn(
        'fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-2 bg-amber-500 px-4 py-2 text-sm font-medium text-steel',
      )}
    >
      <WifiOff size={16} aria-hidden="true" />
      You're offline. Some features may not work.
    </output>
  );
}
