'use client';

/**
 * Client-side wrapper that handles read-toggle + filter UI for the
 * notifications history page. The initial dataset comes from the server
 * component; subsequent refreshes go through the BFF.
 */
import {
  clientFetchNotifications,
  clientMarkAllRead,
  clientMarkRead,
  type NotificationListResponse,
} from '@/lib/api/notifications';
import type { InAppNotificationDto } from '@ustowdispatch/shared';
import { useState, useTransition } from 'react';

const CHANNELS = ['', 'in_app', 'push', 'sms', 'email', 'webhook'] as const;
const STATUSES = [
  '',
  'queued',
  'sent',
  'delivered',
  'failed',
  'bounced',
  'suppressed',
  'dead_lettered',
] as const;

export function NotificationsHistory({
  initial,
}: {
  initial: NotificationListResponse;
}): JSX.Element {
  const [state, setState] = useState<NotificationListResponse>(initial);
  const [channel, setChannel] = useState<string>('');
  const [status, setStatus] = useState<string>('');
  const [search, setSearch] = useState<string>('');
  const [isPending, startTransition] = useTransition();

  function applyFilters(): void {
    startTransition(async () => {
      const data = await clientFetchNotifications({
        channel: channel || undefined,
        status: status || undefined,
        search: search || undefined,
        limit: '50',
      });
      setState(data);
    });
  }

  async function onMarkAll(): Promise<void> {
    await clientMarkAllRead();
    applyFilters();
  }

  async function onItemClick(item: InAppNotificationDto): Promise<void> {
    if (!item.readAt) {
      await clientMarkRead(item.id);
      applyFilters();
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-steel-border bg-steel-mid/40 p-3">
        <label className="flex flex-col text-[10px] uppercase tracking-wider text-text-muted">
          Channel
          <select
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            className="mt-1 rounded-md border border-steel-border bg-steel px-2 py-1 text-xs text-text-primary"
          >
            {CHANNELS.map((c) => (
              <option key={c} value={c}>
                {c || 'All'}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-[10px] uppercase tracking-wider text-text-muted">
          Status
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="mt-1 rounded-md border border-steel-border bg-steel px-2 py-1 text-xs text-text-primary"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s || 'All'}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-1 flex-col text-[10px] uppercase tracking-wider text-text-muted">
          Search
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="event type / body"
            className="mt-1 rounded-md border border-steel-border bg-steel px-2 py-1 text-xs text-text-primary"
          />
        </label>
        <button
          type="button"
          onClick={applyFilters}
          disabled={isPending}
          className="rounded-md bg-orange px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-white hover:bg-orange-light disabled:opacity-50"
        >
          {isPending ? 'Loading…' : 'Apply'}
        </button>
        <button
          type="button"
          onClick={() => void onMarkAll()}
          className="rounded-md border border-steel-border bg-steel-light/30 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-text-secondary hover:text-orange"
        >
          Mark all read
        </button>
      </div>

      <div className="overflow-hidden rounded-lg border border-steel-border">
        <table className="w-full divide-y divide-steel-border text-sm" data-testid="notifications-history">
          <thead className="bg-steel-mid/60 text-left">
            <tr>
              <th className="px-3 py-2 text-xs uppercase tracking-wider text-text-muted">Time</th>
              <th className="px-3 py-2 text-xs uppercase tracking-wider text-text-muted">Event</th>
              <th className="px-3 py-2 text-xs uppercase tracking-wider text-text-muted">Subject</th>
              <th className="px-3 py-2 text-xs uppercase tracking-wider text-text-muted">Status</th>
              <th className="px-3 py-2 text-xs uppercase tracking-wider text-text-muted">Read</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-steel-border">
            {state.items.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-xs text-text-muted">
                  No notifications match the filters.
                </td>
              </tr>
            )}
            {state.items.map((item) => (
              <tr
                key={item.id}
                onClick={() => void onItemClick(item)}
                className={`cursor-pointer transition-colors hover:bg-steel-light/20 ${
                  item.readAt ? '' : 'bg-steel-light/15'
                }`}
              >
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-text-muted">
                  {new Date(item.createdAt).toLocaleString()}
                </td>
                <td className="px-3 py-2 text-xs">{item.eventType}</td>
                <td className="px-3 py-2 text-xs">{item.subject ?? '—'}</td>
                <td className="px-3 py-2 text-xs">{item.status}</td>
                <td className="px-3 py-2 text-xs">{item.readAt ? '✓' : '•'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
