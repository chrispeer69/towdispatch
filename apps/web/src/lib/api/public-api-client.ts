/**
 * Browser-side helpers for /api/public-api/* — hits the BFF; never imports
 * next/headers. Mirrors impound-client.ts.
 */
import type {
  ApiKeyDto,
  CreateApiKeyPayload,
  CreateApiKeyResult,
  CreateWebhookEndpointPayload,
  CreateWebhookEndpointResult,
  PublicWebhookDeliveryDto,
  UpdateWebhookEndpointPayload,
  WebhookEndpointDto,
} from '@ustowdispatch/shared';

async function bff<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/public-api/${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? `Request failed (HTTP ${res.status})`);
  }
  if (res.status === 204) return null as unknown as T;
  return (await res.json()) as T;
}

// API keys
export const clientListKeys = () => bff<ApiKeyDto[]>('keys');
export const clientCreateKey = (body: CreateApiKeyPayload) =>
  bff<CreateApiKeyResult>('keys', { method: 'POST', body: JSON.stringify(body) });
export const clientRevokeKey = (id: string) =>
  bff<ApiKeyDto>(`keys/${id}/revoke`, { method: 'POST', body: JSON.stringify({}) });

// Webhook endpoints
export const clientListWebhooks = () => bff<WebhookEndpointDto[]>('webhooks');
export const clientCreateWebhook = (body: CreateWebhookEndpointPayload) =>
  bff<CreateWebhookEndpointResult>('webhooks', { method: 'POST', body: JSON.stringify(body) });
export const clientUpdateWebhook = (id: string, body: UpdateWebhookEndpointPayload) =>
  bff<WebhookEndpointDto>(`webhooks/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
export const clientDeleteWebhook = (id: string) =>
  bff<void>(`webhooks/${id}`, { method: 'DELETE' });

export const clientListDeliveries = (endpointId: string) =>
  bff<PublicWebhookDeliveryDto[]>(`webhooks/${endpointId}/deliveries`);
export const clientTestWebhook = (endpointId: string) =>
  bff<PublicWebhookDeliveryDto>(`webhooks/${endpointId}/test`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
export const clientRetryDelivery = (deliveryId: string) =>
  bff<PublicWebhookDeliveryDto>(`webhooks/deliveries/${deliveryId}/retry`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
