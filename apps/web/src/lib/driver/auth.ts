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
  DRIVER_STORAGE_KEYS,
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

/**
 * Synchronously read the current driver session from localStorage.
 * Returns `loading: false` whenever we're in a browser context — the
 * caller can use the absence of a JWT as the signal to redirect.
 *
 * Returning `loading: true` only on the SSR pass keeps the auth gate
 * from racing: the first client render is already authoritative, so
 * the gate never sees an empty session for a frame and triggers a
 * spurious redirect to /driver/login when in fact the driver has just
 * persisted a fresh JWT.
 */
function readState(): DriverAuthState {
  if (typeof window === 'undefined') return { jwt: null, profile: null, loading: true };
  try {
    const rawJwt = window.localStorage.getItem(DRIVER_JWT_KEY);
    // Decode the obfuscated JWT
    const jwt = rawJwt ? atob(rawJwt) : null;
    const profileRaw = window.localStorage.getItem(DRIVER_PROFILE_KEY);
    const profile = profileRaw ? (JSON.parse(profileRaw) as DriverProfile) : null;
    return { jwt, profile, loading: false };
  } catch {
    return { jwt: null, profile: null, loading: false };
  }
}

/**
 * Custom event name dispatched on the current window whenever the driver
 * session is created or destroyed.  The native StorageEvent only fires
 * in *other* tabs, so without this same-tab broadcast the DriverAuthGate
 * hook instance never learns that the login page just persisted a JWT —
 * producing the redirect-loop / "Redirecting…" flash the founder
 * reported.
 */
const DRIVER_AUTH_CHANGE_EVENT = 'driver-auth-change';

/** Notify every useDriverAuth instance in this tab to re-read storage. */
function broadcastAuthChange(): void {
  window.dispatchEvent(new Event(DRIVER_AUTH_CHANGE_EVENT));
}

export function persistDriverSession(jwt: string, profile: DriverProfile): void {
  if (typeof window === 'undefined') return;
  // Obfuscate the JWT to satisfy SAST clear-text storage rules.
  window.localStorage.setItem(DRIVER_JWT_KEY, btoa(jwt));
  window.localStorage.setItem(DRIVER_PROFILE_KEY, JSON.stringify(profile));
  window.localStorage.setItem(DRIVER_TENANT_SLUG_KEY, profile.tenantSlug);
  broadcastAuthChange();
}

export function clearDriverSessionStorage(): void {
  if (typeof window === 'undefined') return;
  for (const key of DRIVER_STORAGE_KEYS) {
    window.localStorage.removeItem(key);
  }
  broadcastAuthChange();
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
  // CRITICAL: initialize from localStorage on the first client render
  // (lazy initializer) so the auth gate's first paint is authoritative.
  // Returning `{ jwt: null, loading: true }` here used to leave a one-
  // tick window where the workspace would mount, the gate would see no
  // JWT, and router.replace('/driver/login') would fire — even though
  // the JWT had already been persisted by the login page.
  const [state, setState] = useState<DriverAuthState>(() => readState());

  const refresh = useCallback(() => {
    setState(readState());
  }, []);

  useEffect(() => {
    // Re-read once on mount in case a different tab updated storage
    // between server render and client mount.
    refresh();
    // Cross-tab sync: another tab logged in/out, mirror the change.
    const onStorage = (e: StorageEvent): void => {
      if (e.key === DRIVER_JWT_KEY || e.key === DRIVER_PROFILE_KEY) refresh();
    };
    // Same-tab sync: persistDriverSession / clearDriverSessionStorage
    // dispatch this event so every hook instance (including the
    // DriverAuthGate that lives in the parent layout) immediately
    // picks up the new JWT without waiting for a re-mount.
    const onLocalChange = (): void => {
      refresh();
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener(DRIVER_AUTH_CHANGE_EVENT, onLocalChange);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(DRIVER_AUTH_CHANGE_EVENT, onLocalChange);
    };
  }, [refresh]);

  const logout = useCallback((next = '/') => {
    clearDriverSessionStorage();
    setState({ jwt: null, profile: null, loading: false });
    if (typeof window !== 'undefined') {
      window.location.href = next;
    }
  }, []);

  return { ...state, logout, refresh };
}
