/**
 * BFF binary route for the lien-sale notice PDFs. Streams the
 * application/pdf body from the API's GET /lien-cases/:id/forms/:formType
 * through to the browser. More specific than the [...path] catch-all, so it
 * takes precedence for this path.
 */
import { apiServerBffRaw } from '@/lib/api/client';
import { type NextRequest, NextResponse } from 'next/server';

interface Ctx {
  params: Promise<{ id: string; formType: string }>;
}

export async function GET(_req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id, formType } = await ctx.params;
  const upstream = await apiServerBffRaw(`/lien-cases/${id}/forms/${formType}`, { method: 'GET' });
  if (!upstream.ok) {
    const body = (await upstream.json().catch(() => null)) as { message?: string } | null;
    return NextResponse.json(
      { message: body?.message ?? 'Failed to generate the notice PDF.' },
      { status: upstream.status },
    );
  }
  const buf = await upstream.arrayBuffer();
  return new NextResponse(buf, {
    status: 200,
    headers: {
      'content-type': 'application/pdf',
      'content-disposition':
        upstream.headers.get('content-disposition') ??
        `attachment; filename="lien-${formType}-${id}.pdf"`,
    },
  });
}
