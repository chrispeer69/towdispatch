/**
 * [FLEET_DEBUG_V2] — temporary diagnostic. Revert once root cause is found.
 *
 * Wraps next/navigation's `redirect()` with stack-trace logging so we can see
 * EXACTLY which line of code is responsible for the /login bounce on /fleet
 * in production. The PR #8/#10 round-trip identified that /auth/me is fine
 * (200 OK with the user) and yet the user still ends up on /login after a
 * brief flash of the Fleet shell. Something is calling redirect() — this
 * tool prints what and from where.
 *
 * Behavior: forwards the call to the real redirect(). The console.error
 * with stack trace fires synchronously BEFORE the throw, so Railway logs
 * always capture it even though redirect() interrupts the render.
 *
 * Per-render correlation id (rid) is generated via React.cache() so every
 * log line from the same request render shares the same id. Grep one rid
 * out of Railway noise to get the full ordered trace for one user action.
 */
import { redirect as nextRedirect } from 'next/navigation';
import { cache } from 'react';

export const getRequestId = cache((): string => Math.random().toString(36).slice(2, 10));

export function tracedRedirect(url: string, reason: string): never {
  const rid = getRequestId();
  const stack = new Error('redirect-trace').stack ?? '(no stack)';
  // First 8 frames is enough to identify the call site without dumping
  // node_modules internals.
  const trimmed = stack.split('\n').slice(0, 10).join(' | ');
  // eslint-disable-next-line no-console
  console.error(`[FLEET_DEBUG_V2 rid=${rid}] redirect → ${url} reason=${reason} stack=${trimmed}`);
  nextRedirect(url);
}
