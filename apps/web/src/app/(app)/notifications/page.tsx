/**
 * /notifications — the full history view with filters.
 *
 * Server-rendered list. Client-side "mark read" is a fetch to the BFF;
 * we revalidate on focus to pick up the new state.
 */
import { fetchInAppNotifications } from '@/lib/api/notifications.server';
import type { NotificationListQuery } from '@ustowdispatch/shared';
import { NotificationsHistory } from './history.client';

export const metadata = { title: 'Notifications — TowCommand' };

export default async function NotificationsHistoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}): Promise<JSX.Element> {
  const params = await searchParams;
  const filter: Partial<NotificationListQuery> = {
    channel: (params.channel as NotificationListQuery['channel']) ?? undefined,
    status: (params.status as NotificationListQuery['status']) ?? undefined,
    eventType: params.eventType ?? undefined,
    search: params.search ?? undefined,
  };
  const data = await fetchInAppNotifications({
    ...(filter.channel ? { channel: filter.channel } : {}),
    ...(filter.status ? { status: filter.status } : {}),
    ...(filter.eventType ? { eventType: filter.eventType } : {}),
    ...(filter.search ? { search: filter.search } : {}),
    limit: '50',
  });
  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-condensed text-3xl font-extrabold uppercase tracking-tight">
          Notifications
        </h1>
        <p className="mt-1 text-sm text-text-secondary">
          {data.total} total · {data.unread} unread
        </p>
      </header>
      <NotificationsHistory initial={data} />
    </div>
  );
}
