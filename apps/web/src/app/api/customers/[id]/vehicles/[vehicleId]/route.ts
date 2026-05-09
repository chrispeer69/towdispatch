import { ApiError, apiServerBff } from '@/lib/api/client';
import { type NextRequest, NextResponse } from 'next/server';

interface Ctx {
  params: Promise<{ id: string; vehicleId: string }>;
}

export async function POST(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id, vehicleId } = await ctx.params;
  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  try {
    await apiServerBff<void>(`/customers/${id}/vehicles/${vehicleId}`, {
      method: 'POST',
      body,
    });
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return handle(err);
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id, vehicleId } = await ctx.params;
  try {
    await apiServerBff<void>(`/customers/${id}/vehicles/${vehicleId}`, { method: 'DELETE' });
    return new NextResponse(null, { status: 204 });
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
