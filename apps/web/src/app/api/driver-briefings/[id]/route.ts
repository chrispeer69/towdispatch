/**
 * BFF for PATCH /api/driver-briefings/:id — operator-facing edit /
 * activate / deactivate of a driver daily briefing (RBAC: OWNER, ADMIN).
 * Pass-through to PATCH /driver-briefings/:id.
 */
import { ApiError, apiServerBff } from '@/lib/api/client';
import { type NextRequest, NextResponse } from 'next/server';

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ message: 'Invalid JSON body' }, { status: 400 });
  }
  try {
    const data = await apiServerBff<unknown>(`/driver-briefings/${id}`, {
      method: 'PATCH',
      body,
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
