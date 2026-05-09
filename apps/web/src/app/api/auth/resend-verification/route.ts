import { ApiError, apiServerBff } from '@/lib/api/client';
import { NextResponse } from 'next/server';

export async function POST(): Promise<NextResponse> {
  try {
    await apiServerBff('/auth/resend-verification', { method: 'POST', body: {} });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json({ code: err.code, message: err.message }, { status: err.status });
    }
    return NextResponse.json({ message: 'Unexpected error' }, { status: 500 });
  }
}
