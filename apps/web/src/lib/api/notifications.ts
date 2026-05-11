/**
 * Notifications API — both server-side (apiServer) and client-side (fetch
 * the BFF) helpers. Mirrors lib/api/billing.ts.
 *
 * The web app talks to /api/notifications/* and /api/admin/notifications/*
 * (BFF) which proxies to the API.
 */
import type {
  DispatchNotificationResult,
  InAppNotificationDto,
  NotificationTemplateDto,
  PreviewTemplatePayload,
  UpdateUserPreferencesPayload,
  UpsertTemplatePayload,
  UpsertWebhookSubscriptionPayload,
  UserPreferencesDto,
  WebhookSubscriptionDto,
} from '@ustowdispatch/shared';

export interface NotificationListResponse {
  items: InAppNotificationDto[];
  total: number;
  unread: number;
}

// ---------- Client-side (Client Components) ----------
// These call our Next.js BFF (/api/notifications/*) which forwards to the API
// with the user's bearer cookie.

export async function clientFetchNotifications(
  query: Record<string, string | undefined> = {},
): Promise<NotificationListResponse> {
  const res = await fetch(`/api/notifications${toQuery(query)}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`notifications list failed: ${res.status}`);
  return (await res.json()) as NotificationListResponse;
}

export async function clientMarkRead(deliveryId: string): Promise<void> {
  await fetch(`/api/notifications/${deliveryId}/read`, { method: 'PATCH' });
}

export async function clientMarkAllRead(): Promise<{ marked: number }> {
  const res = await fetch('/api/notifications/mark-all-read', { method: 'POST' });
  if (!res.ok) throw new Error('mark-all-read failed');
  return (await res.json()) as { marked: number };
}

export async function clientUpdatePreferences(
  body: UpdateUserPreferencesPayload,
): Promise<UserPreferencesDto> {
  const res = await fetch('/api/notifications/preferences/me', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('update prefs failed');
  return (await res.json()) as UserPreferencesDto;
}

export async function clientRetryDeadLetter(id: string): Promise<DispatchNotificationResult> {
  const res = await fetch(`/api/admin/notifications/dead-letters/${id}/retry`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error('retry failed');
  return (await res.json()) as DispatchNotificationResult;
}

export async function clientPreviewTemplate(
  body: PreviewTemplatePayload,
): Promise<{ subject: string | null; body: string; bodyPlain: string | null }> {
  const res = await fetch('/api/admin/notifications/templates/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('preview failed');
  return await res.json();
}

export async function clientUpsertTemplate(
  body: UpsertTemplatePayload,
): Promise<NotificationTemplateDto> {
  const res = await fetch('/api/admin/notifications/templates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('save template failed');
  return await res.json();
}

export async function clientCreateWebhook(
  body: UpsertWebhookSubscriptionPayload,
): Promise<WebhookSubscriptionDto> {
  const res = await fetch('/api/admin/notifications/webhooks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('create webhook failed');
  return await res.json();
}

export async function clientRotateWebhook(id: string): Promise<WebhookSubscriptionDto> {
  const res = await fetch(`/api/admin/notifications/webhooks/${id}/rotate`, { method: 'POST' });
  if (!res.ok) throw new Error('rotate failed');
  return await res.json();
}

export async function clientDeleteWebhook(id: string): Promise<void> {
  await fetch(`/api/admin/notifications/webhooks/${id}`, { method: 'DELETE' });
}

function toQuery(q: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v !== undefined && v !== '') params.set(k, v);
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}
