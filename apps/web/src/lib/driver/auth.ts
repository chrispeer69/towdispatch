'use client';

/**
 * useDriverAuth — minimal client-side hook for reading & managing the
 * driver session. Stores the JWT plus a slim profile snapshot
 * (driverId, name, tenant slug + name) in localStorage so the workspace
 * can render the top bar without an extra fetch.
 *
 * The httpOnly-cookie variant the operator app uses is unnecessary here:
 *   - the API is reachable directly from the browser
 *   - the JWT carries tenant + driver id, so RLS still enforces isolation
 *   - clearing the key fully revokes the local session
 * Documented as a Session 3 judgment call in the PR.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  DRIVER_JWT_KEY,
  DRIVER_PROFILE_KEY,
  DRIVER_TENANT_CODE_KEY,
  DRIVER_TENANT_SLUG_KEY,
} from './storage-keys';

export interface DriverProfile {
  driverId: string;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  employeeNumber: string | null;
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  expiresAt: number;
}

export interface DriverAuthState {
  jwt: string | null;
  profile: DriverProfile | null;
  loading: boolean;
}

function readState(): DriverAuthState {
  if (typeof window === 'undefined') return { jwt: null, profile: null, loading: true };
  try {
    const jwt = window.localStorage.getItem(DRIVER_JWT_KEY);
    const profileRaw = window.localStorage.getItem(DRIVER_PROFILE_KEY);
    const profile = profileRaw ? (JSON.parse(profileRaw) as DriverProfile) : null;
    return { jwt, profile, loading: false };
  } catch {
    return { jwt: null, profile: null, loading: false };
  }
}

export function persistDriverSession(jwt: string, profile: DriverProfile): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(DRIVER_JWT_KEY, jwt);
  window.localStorage.setItem(DRIVER_PROFILE_KEY, JSON.stringify(profile));
  window.localStorage.setItem(DRIVER_TENANT_SLUG_KEY, profile.tenantSlug);
}

export function clearDriverSessionStorage(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(DRIVER_JWT_KEY);
  window.localStorage.removeItem(DRIVER_PROFILE_KEY);
}

export function readTenantSlugHint(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(DRIVER_TENANT_SLUG_KEY);
}

/**
 * 6-digit company-code hint persisted from the last successful tenant
 * lookup. Used by /driver/login to skip the code-entry step when the
 * driver has signed in on this device before, and by the /driver/d/[code]
 * vanity URL handler to remember the code without asking again.
 */
export function readTenantCodeHint(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(DRIVER_TENANT_CODE_KEY);
}

export function persistTenantCode(code: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(DRIVER_TENANT_CODE_KEY, code);
}

/**
 * Wipe the cached 6-digit company code from this device. Used when the
 * driver taps “Change” on the picker, which signals that the tablet is
 * being repurposed for a different workshop — we don’t want the
 * auto-advance logic to immediately re-fetch the prior workshop.
 */
export function clearTenantCode(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(DRIVER_TENANT_CODE_KEY);
}

export function useDriverAuth(): DriverAuthState & {
  logout: (next?: string) => void;
  refresh: () => void;
} {
  const [state, setState] = useState<DriverAuthState>({ jwt: null, profile: null, loading: true });

  const refresh = useCallback(() => {
    setState(readState());
  }, []);

  useEffect(() => {
    refresh();
    // Cross-tab sync: another tab logged in/out, mirror the change.
    const onStorage = (e: StorageEvent): void => {
      if (e.key === DRIVER_JWT_KEY || e.key === DRIVER_PROFILE_KEY) refresh();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [refresh]);

  const logout = useCallback((next = '/driver/login') => {
    clearDriverSessionStorage();
    setState({ jwt: null, profile: null, loading: false });
    if (typeof window !== 'undefined') {
      window.location.href = next;
    }
  }, []);

  return { ...state, logout, refresh };
}
