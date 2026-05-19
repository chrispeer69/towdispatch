/**
 * BFF for /api/driver-briefings — operator-facing CREATE of a new
 * driver daily briefing (RBAC: OWNER, ADMIN). Pass-through to POST
 * /driver-briefings.
 */
import { ApiError, apiServerBff } from '@/lib/api/client';
import { type NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ message: 'Invalid JSON body' }, { status: 400 });
  }
  try {
    const data = await apiServerBff<unknown>('/driver-briefings', {
      method: 'POST',
      body,
    });
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json(
        { code: err.code, message: err.message, errors: err.details },
        { status: err.status },
      );
    }
    return NextResponse.json({ message: 'Unexpected error' }, { status: 500 });
  }
}
