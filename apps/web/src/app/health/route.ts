/**
 * GET /health — web liveness probe (Phase 0 hardening, Session 17).
 *
 * Always 200 when the Next.js server can serve HTTP. Mirrors the API's
 * /health. `force-dynamic` so it is never statically cached and always
 * reflects the live process. Public — no auth.
 */
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export function GET(): NextResponse {
  return NextResponse.json({
    status: 'ok',
    service: 'web',
    uptimeSeconds: Math.floor(process.uptime()),
  });
}
