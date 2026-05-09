import { ApiError, apiServerBff } from '@/lib/api/client';
import { type NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const search = req.nextUrl.search;
  try {
    const data = await apiServerBff<unknown>(`/vehicles${search}`, { method: 'GET' });
    return NextResponse.json(data);
  } catch (err) {
    return handle(err);
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ message: 'Invalid JSON' }, { status: 400 });
  }
  try {
    const data = await apiServerBff<unknown>('/vehicles', { method: 'POST', body });
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return handle(err);
  }
}

function handle(err: unknown): NextResponse {
  if (err instanceof ApiError) {
    return NextResponse.json(
      { code: err.code, message: err.message, errors: err.details },
      { status: err.status },
    );
  }
  return NextResponse.json({ message: 'Unexpected error' }, { status: 500 });
}
