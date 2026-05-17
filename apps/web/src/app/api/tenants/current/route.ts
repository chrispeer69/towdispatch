/**
 * BFF proxy for /tenants/current. Used by the /settings/company page
 * to read + update the caller's tenant. The API gates PATCH to OWNER
 * and ADMIN roles; lesser roles get 403, which we pass through as a
 * structured error.
 */
import { ApiError, apiServerBff } from '@/lib/api/client';
import { NextResponse } from 'next/server';

export async function GET(): Promise<NextResponse> {
  try {
    const data = await apiServerBff<unknown>('/tenants/current', { method: 'GET' });
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

export async function PATCH(req: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ message: 'Invalid JSON' }, { status: 400 });
  }
  try {
    const data = await apiServerBff<unknown>('/tenants/current', {
      method: 'PATCH',
      body,
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
