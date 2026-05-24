import type {
  DeadLetterDto,
  DeliveryMetrics,
  NotificationTemplateDto,
  UserPreferencesDto,
  NotificationWebhookDeliveryDto,
  WebhookSubscriptionDto,
} from '@ustowdispatch/shared';
import { apiServer } from './client';
import type { NotificationListResponse } from './notifications';

function toQuery(params: Record<string, string | undefined>): string {
  const entries = Object.entries(params).filter(([, v]) => v != null) as [string, string][];
  return entries.length ? `?${new URLSearchParams(entries).toString()}` : '';
}

// ---------- Server-side (Server Components) ----------
export async function fetchInAppNotifications(
  query: Record<string, string | undefined> = {},
): Promise<NotificationListResponse> {
  return apiServer<NotificationListResponse>(`/notifications${toQuery(query)}`);
}
export async function fetchMyPreferences(): Promise<UserPreferencesDto> {
  return apiServer<UserPreferencesDto>('/notifications/preferences/me');
}
export async function fetchDeadLetters(): Promise<DeadLetterDto[]> {
  return apiServer<DeadLetterDto[]>('/admin/notifications/dead-letters');
}
export async function fetchDeliveryMetrics(windowDays = 7): Promise<DeliveryMetrics> {
  return apiServer<DeliveryMetrics>(`/admin/notifications/metrics?windowDays=${windowDays}`);
}
export async function fetchTemplates(): Promise<NotificationTemplateDto[]> {
  return apiServer<NotificationTemplateDto[]>('/admin/notifications/templates');
}
export async function fetchWebhooks(): Promise<WebhookSubscriptionDto[]> {
  return apiServer<WebhookSubscriptionDto[]>('/admin/notifications/webhooks');
}
export async function fetchWebhookDeliveries(
  subscriptionId: string,
): Promise<NotificationWebhookDeliveryDto[]> {
  return apiServer<NotificationWebhookDeliveryDto[]>(
    `/admin/notifications/webhooks/${subscriptionId}/deliveries`,
  );
}
