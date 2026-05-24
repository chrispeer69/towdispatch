/**
 * Server-side fetchers for the Public API management surface. Used by the
 * /settings/api page to load the initial keys + webhook endpoints. Token is
 * read at the page level and threaded through (see BUILD_DECISIONS Session 9.7).
 */
import type { ApiKeyDto, WebhookEndpointDto } from '@ustowdispatch/shared';
import { apiServer } from './client';

export function fetchApiKeys(token: string | null): Promise<ApiKeyDto[]> {
  return apiServer<ApiKeyDto[]>('/public-api/keys', { accessToken: token });
}

export function fetchWebhookEndpoints(token: string | null): Promise<WebhookEndpointDto[]> {
  return apiServer<WebhookEndpointDto[]>('/public-api/webhooks', { accessToken: token });
}
