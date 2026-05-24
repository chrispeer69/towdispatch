/**
 * Next.js instrumentation hook (R-06). With a `src/` directory Next loads this
 * from src/instrumentation.ts. register() runs once per server runtime at
 * boot; we lazy-import the matching Sentry config so the Node SDK never loads
 * in the Edge runtime and vice-versa.
 *
 * onRequestError forwards server-side (incl. nested RSC) errors to Sentry —
 * the Next 15 hook that replaces manual try/catch around the render path.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('../sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('../sentry.edge.config');
  }
}

export { captureRequestError as onRequestError } from '@sentry/nextjs';
