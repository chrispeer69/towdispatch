import { ApiError, apiServerBff } from '@/lib/api/client';
import { type NextRequest, NextResponse } from 'next/server';

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;
  try {
    await apiServerBff<unknown>(`/import/runs/${id}/cancel`, { method: 'POST' });
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json({ code: err.code, message: err.message }, { status: err.status });
    }
    return NextResponse.json({ message: 'Unexpected error' }, { status: 500 });
  }
}
