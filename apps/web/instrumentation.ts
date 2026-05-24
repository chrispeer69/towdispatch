/**
 * Next.js server instrumentation hook (Phase 0 hardening, Session 17).
 *
 * Loads the runtime-appropriate Sentry config on boot and forwards nested
 * React Server Component / route-handler errors to Sentry via onRequestError.
 * Both paths are DSN-gated inside the imported configs, so this is inert when
 * SENTRY_DSN is empty.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

export { captureRequestError as onRequestError } from '@sentry/nextjs';
