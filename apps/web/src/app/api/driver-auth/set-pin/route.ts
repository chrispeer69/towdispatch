/**
 * BFF for /api/driver-auth/set-pin — operator-side enrollment of a
 * driver's 4-digit PIN. Pass-through to POST /driver-auth/set-pin which
 * is RBAC-gated to OWNER / ADMIN / MANAGER on the API side.
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
    const data = await apiServerBff<unknown>('/driver-auth/set-pin', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return NextResponse.json(data);
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
