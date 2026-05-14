'use client';

import type { MeResponse } from '@ustowdispatch/shared';
/**
 * Hands the user/tenant DTO returned by /auth/me from the server layout to
 * any client component that needs it. We deliberately avoid SWR / TanStack
 * Query here — the layout already runs on every navigation, so the DTO is
 * always fresh.
 */
import { type ReactNode, createContext, useContext } from 'react';

const SessionContext = createContext<MeResponse | null>(null);

export function SessionProvider({
  value,
  children,
}: {
  value: MeResponse;
  children: ReactNode;
}): JSX.Element {
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): MeResponse {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error('useSession must be used within SessionProvider (inside the (app) layout)');
  }
  return ctx;
}

export function useUser(): MeResponse['user'] {
  return useSession().user;
}

export function useTenant(): MeResponse['tenant'] {
  return useSession().tenant;
}
