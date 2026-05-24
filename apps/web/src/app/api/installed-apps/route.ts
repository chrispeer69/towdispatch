/**
 * BFF for /api/installed-apps — operator's installed-apps list (GET), proxied
 * to the marketplace-api /apps/installed with the operator session token.
 */
import { ApiError, apiServerBff } from '@/lib/api/client';
import { type NextRequest, NextResponse } from 'next/server';

export async function GET(_req: NextRequest): Promise<NextResponse> {
  try {
    const data = await apiServerBff<unknown>('/apps/installed', { method: 'GET' });
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
