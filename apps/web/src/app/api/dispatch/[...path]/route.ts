/**
 * Generic dispatch BFF proxy. Forwards GET / POST to the API under the
 * caller's bearer token. The web dispatch board hits these for the live
 * board feed and for every drag/drop assign call. Per-resource routes were
 * skipped in favor of the catch-all because every endpoint here just wraps
 * an upstream call — there's no extra logic the BFF needs to add.
 */
import { ApiError, apiServerBff } from '@/lib/api/client';
import { type NextRequest, NextResponse } from 'next/server';

async function forward(
  req: NextRequest,
  path: string[],
  method: 'GET' | 'POST',
): Promise<NextResponse> {
  const upstream = `/dispatch/${path.join('/')}`;
  let body: unknown;
  if (method !== 'GET') {
    try {
      body = await req.json();
    } catch {
      body = undefined;
    }
  }
  try {
    const data = await apiServerBff<unknown>(upstream, {
      method,
      ...(body !== undefined ? { body } : {}),
    });
    return NextResponse.json(data ?? null, { status: method === 'POST' ? 200 : 200 });
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

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  const { path } = await params;
  return forward(req, path, 'GET');
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  const { path } = await params;
  return forward(req, path, 'POST');
}
