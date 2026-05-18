'use client';

/**
 * Network-aware banner that appears on every /driver/* page when the
 * browser reports offline OR when the local queue has unreplayed
 * actions. Tapping the banner opens /driver/offline.
 */
import { readQueue } from '@/lib/driver/offline-queue';
import { CloudOff, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

export function OfflineBanner(): JSX.Element | null {
  const [online, setOnline] = useState(true);
  const [queued, setQueued] = useState(0);

  useEffect(() => {
    const refresh = (): void => {
      setOnline(typeof navigator === 'undefined' ? true : navigator.onLine);
      setQueued(readQueue().length);
    };
    refresh();
    window.addEventListener('online', refresh);
    window.addEventListener('offline', refresh);
    const t = setInterval(refresh, 5000);
    return () => {
      window.removeEventListener('online', refresh);
      window.removeEventListener('offline', refresh);
      clearInterval(t);
    };
  }, []);

  if (online && queued === 0) return null;

  return (
    <Link
      href="/driver/offline"
      className="mb-3 flex items-center justify-between gap-2 rounded-[10px] border border-status-warning/40 bg-status-warning/10 p-3 text-sm"
    >
      <span className="flex items-center gap-2">
        {!online ? <CloudOff className="h-4 w-4" /> : <RotateCcw className="h-4 w-4" />}
        <span>
          {!online ? 'Offline' : 'Pending sync'} — {queued} queued action{queued === 1 ? '' : 's'}
        </span>
      </span>
      <span className="text-xs underline">Review</span>
    </Link>
  );
}
