/**
 * BFF root for /api/lien-cases — list (GET) + open (POST). Sub-paths
 * (/:id, /:id/advance, /:id/notices, /state-rules) are handled by
 * [...path]/route.ts; the binary PDF by [id]/forms/[formType]/route.ts.
 */
import { ApiError, apiServerBff } from '@/lib/api/client';
import { type NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const data = await apiServerBff<unknown>(`/lien-cases${req.nextUrl.search}`, { method: 'GET' });
    return NextResponse.json(data);
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = undefined;
  }
  try {
    const data = await apiServerBff<unknown>('/lien-cases', { method: 'POST', body });
    return NextResponse.json(data);
  } catch (err) {
    return toErrorResponse(err);
  }
}

function toErrorResponse(err: unknown): NextResponse {
  if (err instanceof ApiError) {
    return NextResponse.json(
      { code: err.code, message: err.message, errors: err.details },
      { status: err.status },
    );
  }
  return NextResponse.json({ message: 'Unexpected error' }, { status: 500 });
}
