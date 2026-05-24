/**
 * BFF proxy for POST /tenant-branding/logo (Session 32). The browser sends
 * { fileName, mimeType, dataBase64 } (logo bytes base64-encoded in JSON);
 * we forward it to the API, which stores via the StorageProvider and returns
 * the updated branding DTO.
 */
import { ApiError, apiServerBff } from '@/lib/api/client';
import { NextResponse } from 'next/server';

export async function POST(req: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ message: 'Invalid JSON' }, { status: 400 });
  }
  try {
    const data = await apiServerBff<unknown>('/tenant-branding/logo', { method: 'POST', body });
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
