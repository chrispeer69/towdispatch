/**
 * /admin/notifications — combined admin view.
 *
 * Wraps four sections that originally would each warrant a sub-page
 * (metrics, dead-letters, templates, webhooks). Combined into one
 * tabbed view for v1 to keep the navigation surface lean. Each section
 * is the data the COO needs to triage and is rendered server-side for
 * fast first paint.
 */
import {
  fetchDeadLetters,
  fetchDeliveryMetrics,
  fetchTemplates,
  fetchWebhooks,
} from '@/lib/api/notifications.server';
import { AdminNotificationsView } from './admin.client';

export const metadata = { title: 'Notifications admin — US Tow Dispatch' };

export default async function AdminNotificationsPage(): Promise<JSX.Element> {
  const [metrics, deadLetters, templates, webhooks] = await Promise.all([
    fetchDeliveryMetrics(7),
    fetchDeadLetters(),
    fetchTemplates(),
    fetchWebhooks(),
  ]);
  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-condensed text-3xl font-extrabold uppercase tracking-tight">
          Notifications admin
        </h1>
        <p className="mt-1 text-sm text-text-secondary">
          Metrics, dead-letter inspection, template overrides, and outbound webhooks.
        </p>
      </header>
      <AdminNotificationsView
        initialMetrics={metrics}
        initialDeadLetters={deadLetters}
        initialTemplates={templates}
        initialWebhooks={webhooks}
      />
    </div>
  );
}
