import { ApiError, apiServerBff } from '@/lib/api/client';
import { type NextRequest, NextResponse } from 'next/server';

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id } = await ctx.params;
  try {
    const data = await apiServerBff<unknown>(`/accounts/${id}/rate-card`, { method: 'GET' });
    return NextResponse.json(data);
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
