import { ApiError, apiServerBff } from '@/lib/api/client';
import { type NextRequest, NextResponse } from 'next/server';

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;
  try {
    const data = await apiServerBff<unknown>(`/import/runs/${id}`, { method: 'GET' });
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json({ code: err.code, message: err.message }, { status: err.status });
    }
    return NextResponse.json({ message: 'Unexpected error' }, { status: 500 });
  }
}
