/**
 * BFF for /api/driver-briefings/active — operator-facing read of the
 * tenant's currently-active driver daily briefing. Pass-through to GET
 * /driver-briefings/active.
 *
 * The API endpoint is gated behind DriverAuthGuard for the driver path;
 * for operator-side reads we hit the GET with the operator JWT and the
 * service falls through tenant scope. Operator role is implied by the
 * /settings/* surface.
 */
import { ApiError, apiServerBff } from '@/lib/api/client';
import { type NextRequest, NextResponse } from 'next/server';

export async function GET(_req: NextRequest): Promise<NextResponse> {
  try {
    const data = await apiServerBff<unknown>('/driver-briefings/active', { method: 'GET' });
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof ApiError) {
      // 404 is "no active briefing yet" — surface as a clean 200 with null
      // so the operator UI doesn't have to special-case the not-found path.
      if (err.status === 404) return NextResponse.json(null);
      return NextResponse.json(
        { code: err.code, message: err.message, errors: err.details },
        { status: err.status },
      );
    }
    return NextResponse.json({ message: 'Unexpected error' }, { status: 500 });
  }
}
