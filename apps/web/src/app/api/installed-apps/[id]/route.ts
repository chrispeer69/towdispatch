/**
 * BFF for /api/installed-apps/:id — uninstall (DELETE), proxied to the
 * marketplace-api /apps/installed/:id (revokes the app's OAuth tokens).
 */
import { ApiError, apiServerBff } from '@/lib/api/client';
import { type NextRequest, NextResponse } from 'next/server';

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function DELETE(_req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id } = await ctx.params;
  try {
    await apiServerBff<unknown>(`/apps/installed/${encodeURIComponent(id)}`, { method: 'DELETE' });
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
