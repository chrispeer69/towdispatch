/**
 * Browser client for the Customer Self-Serve Portal (Session 55).
 *
 * Thin wrappers over the same-origin BFF (/api/self-serve/*). The session is a
 * server-set HttpOnly cookie, so requests use `credentials: 'include'` and the
 * client never sees the token. Distinct from lib/portal (S32 account portal).
 */
'use client';
import type {
  PortalBalance,
  PortalIdAttestPayload,
  PortalIdVerificationDto,
  PortalLookupPayload,
  PortalLookupResult,
  PortalPayInitResult,
  PortalReleaseIntentDto,
  PortalSessionView,
} from '@ustowdispatch/shared';

const BASE = '/api/self-serve';

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { message?: string };
      if (body?.message) message = body.message;
    } catch {
      /* keep default */
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export const lookupVehicle = (body: PortalLookupPayload): Promise<PortalLookupResult> =>
  call('/lookup', { method: 'POST', body: JSON.stringify(body) });

export const verifyMagicLink = (token: string): Promise<PortalSessionView> =>
  call('/magic-link/verify', { method: 'POST', body: JSON.stringify({ token }) });

export const getSession = (): Promise<PortalSessionView> => call('/session');

export const attestId = (body: PortalIdAttestPayload): Promise<PortalIdVerificationDto> =>
  call('/id', { method: 'POST', body: JSON.stringify(body) });

export const getBalance = (): Promise<PortalBalance> => call('/balance');

export const startPayment = (): Promise<PortalPayInitResult> => call('/pay', { method: 'POST' });

export const getReleaseIntent = (): Promise<PortalReleaseIntentDto | null> =>
  call('/release-intent');

export const logout = (): Promise<{ ok: true }> => call('/logout', { method: 'POST' });
