'use client';

/**
 * NotificationBell — replaces the static bell in the topbar.
 *
 * - Polls /api/notifications every 30s for the unread count
 * - Click opens a dropdown with the 10 most recent in-app entries
 * - Each entry click marks read + navigates to the relevant deep link
 * - "Mark all read" + "See all" footer buttons
 *
 * Polling beats a socket subscription for v1 because the dispatch socket
 * gateway already carries the heavy live-board traffic — adding a separate
 * notifications namespace was deferred. The 30s cadence is cheap and
 * matches the user expectation set by Linear / GitHub.
 */
import {
  type NotificationListResponse,
  clientFetchNotifications,
  clientMarkAllRead,
  clientMarkRead,
} from '@/lib/api/notifications';
import type { InAppNotificationDto } from '@ustowdispatch/shared';
import { Bell } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

const POLL_INTERVAL_MS = 30_000;

export function NotificationBell(): JSX.Element {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<NotificationListResponse | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await clientFetchNotifications({ limit: '10' });
      setState(data);
    } catch {
      // Silent — the bell is decorative when offline.
    }
  }, []);

  // Initial load + polling.
  useEffect(() => {
    void refresh();
    const id = setInterval(() => {
      void refresh();
    }, POLL_INTERVAL_MS);
    return (): void => clearInterval(id);
  }, [refresh]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent): void {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener('mousedown', handler);
    return (): void => window.removeEventListener('mousedown', handler);
  }, [open]);

  const unread = state?.unread ?? 0;

  async function onItemClick(item: InAppNotificationDto): Promise<void> {
    if (!item.readAt) {
      await clientMarkRead(item.id);
      void refresh();
    }
  }

  async function onMarkAll(): Promise<void> {
    await clientMarkAllRead();
    void refresh();
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-label="Notifications"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="relative flex h-9 w-9 items-center justify-center rounded-[8px] border border-steel-border bg-steel-light/40 text-text-secondary transition-colors hover:text-text-primary"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span
            aria-label={`${unread} unread notifications`}
            className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-orange px-1 text-[10px] font-bold text-white shadow-orange-glow"
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[380px] rounded-[12px] border border-steel-border bg-steel-mid shadow-xl">
          <div className="flex items-center justify-between border-b border-steel-border px-4 py-3">
            <span className="text-xs font-extrabold uppercase tracking-wider text-text-primary">
              Notifications
            </span>
            <button
              type="button"
              onClick={() => void onMarkAll()}
              className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary hover:text-orange"
            >
              Mark all read
            </button>
          </div>
          <div className="max-h-[420px] overflow-y-auto">
            {state === null && (
              <div className="px-4 py-8 text-center text-xs text-text-muted">Loading…</div>
            )}
            {state && state.items.length === 0 && (
              <div className="px-4 py-8 text-center text-xs text-text-muted">
                No notifications yet
              </div>
            )}
            {state?.items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => void onItemClick(item)}
                className={`flex w-full flex-col gap-1 border-b border-steel-border/60 px-4 py-3 text-left transition-colors hover:bg-steel-light/30 ${
                  item.readAt ? '' : 'bg-steel-light/15'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="line-clamp-1 text-sm font-semibold text-text-primary">
                    {item.subject ?? prettyEvent(item.eventType)}
                  </span>
                  {!item.readAt && (
                    <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-orange" />
                  )}
                </div>
                <span className="line-clamp-2 text-xs text-text-secondary">{item.body}</span>
                <span className="mt-1 font-mono text-[10px] uppercase tracking-wider text-text-muted">
                  {item.category} - {timeAgo(item.createdAt)}
                </span>
              </button>
            ))}
          </div>
          <div className="border-t border-steel-border px-4 py-2 text-center">
            <Link
              href="/notifications"
              onClick={() => setOpen(false)}
              className="text-xs font-semibold text-orange hover:text-orange-light"
            >
              See all notifications →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

function prettyEvent(eventType: string): string {
  return eventType.replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
