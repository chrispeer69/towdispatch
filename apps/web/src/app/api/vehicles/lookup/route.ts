/**
 * BFF for GET /vehicles/lookup. Used by the call-intake screen to detect
 * "this vehicle already exists" when the dispatcher types plate + state.
 * 404 = no match (handled gracefully by the caller); 200 = existing vehicle.
 */
import { ApiError, apiServerBff } from '@/lib/api/client';
import { type NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const search = req.nextUrl.search;
  try {
    const data = await apiServerBff<unknown>(`/vehicles/lookup${search}`, { method: 'GET' });
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
