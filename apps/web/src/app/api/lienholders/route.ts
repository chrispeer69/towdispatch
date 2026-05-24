/**
 * BFF root for /api/lienholders — list (GET) + create (POST). Sub-paths
 * (/:id GET/PATCH/DELETE) are handled by [...path]/route.ts.
 */
import { ApiError, apiServerBff } from '@/lib/api/client';
import { type NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const data = await apiServerBff<unknown>(`/lienholders${req.nextUrl.search}`, {
      method: 'GET',
    });
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
    const data = await apiServerBff<unknown>('/lienholders', { method: 'POST', body });
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
