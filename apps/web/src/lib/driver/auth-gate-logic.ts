/**
 * Pure decision helpers powering <DriverAuthGate />. Extracted so the
 * unit tests can pin the redirect behavior without dragging in next/router.
 */

/** Paths under /driver/* that are reachable without a session. */
export const PUBLIC_DRIVER_PATHS = ['/driver/login', '/driver/set-pin', '/driver/locked'] as const;

export interface AuthGateInputs {
  pathname: string;
  hasJwt: boolean;
}

export interface AuthGateDecision {
  action: 'render' | 'redirect-to-login' | 'redirect-to-workspace';
  next?: string;
}

/**
 * Decide what the gate should do for a given (pathname, hasJwt) tuple:
 *   - public path + no jwt        → render
 *   - public path + jwt (login)   → redirect-to-workspace (already signed in)
 *   - guarded path + no jwt       → redirect-to-login (preserve ?next=)
 *   - guarded path + jwt          → render
 */
export function decideAuthGate(input: AuthGateInputs): AuthGateDecision {
  const isPublic = PUBLIC_DRIVER_PATHS.some(
    (p) => input.pathname === p || input.pathname.startsWith(`${p}/`),
  );
  if (isPublic) {
    if (input.hasJwt && input.pathname.startsWith('/driver/login')) {
      return { action: 'redirect-to-workspace' };
    }
    return { action: 'render' };
  }
  if (!input.hasJwt) {
    return { action: 'redirect-to-login', next: input.pathname };
  }
  return { action: 'render' };
}
