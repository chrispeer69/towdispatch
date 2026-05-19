/**
 * BFF for /api/accounts/search — typeahead search for the operator-side
 * Tier Offer Composer recipient picker. Pass-through to /accounts/search.
 */
import { ApiError, apiServerBff } from '@/lib/api/client';
import { type NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const search = req.nextUrl.search;
  try {
    const data = await apiServerBff<unknown>(`/accounts/search${search}`, { method: 'GET' });
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
