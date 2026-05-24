/**
 * BFF for GET /users/invites — list pending invites with optional status
 * filter. Query passes through to the API verbatim.
 */
import { ApiError, apiServerBff } from '@/lib/api/client';
import { type NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const status = req.nextUrl.searchParams.get('status') ?? 'pending';
  try {
    const data = await apiServerBff<unknown>(
      `/users/invites?status=${encodeURIComponent(status)}`,
      {
        method: 'GET',
      },
    );
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
