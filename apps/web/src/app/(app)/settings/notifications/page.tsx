/**
 * /settings/notifications — per-user preferences matrix + quiet hours.
 *
 * Server component loads the initial DTO; client wrapper handles toggles
 * and submit. The matrix is rendered as `event_category × channel`.
 */
import { fetchMyPreferences } from '@/lib/api/notifications.server';
import { NotificationsSettings } from './settings.client';

export const metadata = { title: 'Notification settings — TowCommand' };

export default async function NotificationSettingsPage(): Promise<JSX.Element> {
  const prefs = await fetchMyPreferences();
  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-condensed text-3xl font-extrabold uppercase tracking-tight">
          Notification settings
        </h1>
        <p className="mt-1 text-sm text-text-secondary">
          Choose which events reach you on which channels, and set quiet-hours.
        </p>
      </header>
      <NotificationsSettings initial={prefs} />
    </div>
  );
}
