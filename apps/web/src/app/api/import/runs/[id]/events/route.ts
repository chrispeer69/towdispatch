import { ApiError, apiServerBff } from '@/lib/api/client';
import { type NextRequest, NextResponse } from 'next/server';

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;
  try {
    const data = await apiServerBff<{ events: Array<Record<string, unknown>> }>(
      `/import/runs/${id}/events${req.nextUrl.search}`,
      { method: 'GET' },
    );
    // If the caller passes ?format=csv, render the events as CSV for the
    // "Download errors" link. Otherwise return JSON.
    if (req.nextUrl.searchParams.get('format') === 'csv') {
      const header = 'record_type,action,external_id,towdispatch_id,error_message,occurred_at\n';
      const lines = data.events.map((e) =>
        [
          e.record_type ?? '',
          e.action ?? '',
          e.external_id ?? '',
          e.towdispatch_id ?? '',
          (e.error_message ?? '').toString().replace(/"/g, '""'),
          e.occurred_at ?? '',
        ]
          .map((v) => (typeof v === 'string' && v.includes(',') ? `"${v}"` : v))
          .join(','),
      );
      return new NextResponse(header + lines.join('\n'), {
        status: 200,
        headers: { 'content-type': 'text/csv' },
      });
    }
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json({ code: err.code, message: err.message }, { status: err.status });
    }
    return NextResponse.json({ message: 'Unexpected error' }, { status: 500 });
  }
}
