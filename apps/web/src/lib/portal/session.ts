/**
 * Portal session + branding helpers (Session 32). Server-only.
 *
 * Mirrors lib/auth/session.ts (requireUser / getOptionalUser) but for the
 * portal realm: branding is resolved from the Host, and the session comes from
 * the portal cookie. A missing/expired portal token bounces to /portal/login.
 */
import type { PortalBrandingDto, PortalUserDto } from '@ustowdispatch/shared';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { PortalApiError, portalApiSafe } from './client';
import { readPortalToken } from './cookies';

/** Branding for the current Host, or null when the host maps to no tenant. */
export const getPortalBranding = cache(async (): Promise<PortalBrandingDto | null> => {
  const result = await portalApiSafe<{ branding: PortalBrandingDto }>('/portal/public/resolve');
  if (result.error) return null;
  return result.data.branding;
});

/** The authenticated portal user, or null when not signed in. */
export const getOptionalPortalUser = cache(async (): Promise<PortalUserDto | null> => {
  const token = await readPortalToken();
  if (!token) return null;
  try {
    const result = await portalApiSafe<PortalUserDto>('/portal/me', { token });
    if (result.error) return null;
    return result.data;
  } catch (err) {
    if (err instanceof PortalApiError && err.status >= 500) throw err;
    return null;
  }
});

export async function requirePortalUser(): Promise<PortalUserDto> {
  const user = await getOptionalPortalUser();
  if (!user) redirect('/portal/login');
  return user;
}
