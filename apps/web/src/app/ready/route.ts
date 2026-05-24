/**
 * GET /ready — web readiness probe (Phase 0 hardening, Session 17).
 *
 * The web app is a stateless SSR frontend; its only hard dependency is the
 * API. We deliberately do NOT 503 the web when the API is down: web and API
 * deploy as independent Railway services, so cascading the API's readiness
 * into the web's would deadlock deploys (web never goes ready until API is,
 * and the web can still render its own error/loading states). Instead we
 * always return 200 (the SSR server being up IS its readiness) and surface
 * API reachability as an observability field.
 *
 * Public, never cached.
 */
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const API_PROBE_TIMEOUT_MS = 2000;

export async function GET(): Promise<NextResponse> {
  const apiBase = process.env.NEXT_PUBLIC_API_URL ?? process.env.API_PUBLIC_URL;
  let api: 'ok' | 'down' | 'unknown' = 'unknown';

  if (apiBase) {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), API_PROBE_TIMEOUT_MS);
      const res = await fetch(`${apiBase.replace(/\/$/, '')}/ready`, {
        signal: controller.signal,
        cache: 'no-store',
      }).finally(() => clearTimeout(t));
      api = res.ok ? 'ok' : 'down';
    } catch {
      api = 'down';
    }
  }

  return NextResponse.json({ status: 'ok', service: 'web', checks: { api } });
}
