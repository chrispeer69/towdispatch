import { ApiError, apiServerBff } from '@/lib/api/client';
import { NextResponse } from 'next/server';

export async function POST(): Promise<NextResponse> {
  try {
    const data = await apiServerBff<unknown>('/service-catalog/seed-defaults', {
      method: 'POST',
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
