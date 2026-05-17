import { ApiError, apiServerBff } from '@/lib/api/client';
import { type NextRequest, NextResponse } from 'next/server';

interface Ctx {
  params: Promise<{ id: string; availabilityId: string }>;
}

export async function DELETE(_req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id, availabilityId } = await ctx.params;
  try {
    await apiServerBff<void>(`/accounts/${id}/rate-card/availability/${availabilityId}`, {
      method: 'DELETE',
    });
    return new NextResponse(null, { status: 204 });
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
