import { ApiError, apiServerBff } from '@/lib/api/client';
import { NextResponse } from 'next/server';

export async function GET(): Promise<NextResponse> {
  try {
    const data = await apiServerBff<unknown>('/service-rates', { method: 'GET' });
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
