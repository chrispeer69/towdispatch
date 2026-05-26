import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(req: NextRequest) {
  const url = req.nextUrl;
  const hostname = req.headers.get('host') || '';

  // Only apply these strict redirects in production for the new domain
  const isProduction = hostname.includes('ustowdispatch.com');
  const isAppDomain = hostname.startsWith('app.');
  const isRootDomain = isProduction && !isAppDomain;

  // 1. If a user is on the root landing page (ustowdispatch.com) and clicks a link like /login or /signup,
  // we automatically redirect them to the app subdomain (app.ustowdispatch.com/login).
  if (isRootDomain && url.pathname !== '/') {
    return NextResponse.redirect(`https://app.ustowdispatch.com${url.pathname}${url.search}`);
  }

  // 2. If a user directly visits the app subdomain root (app.ustowdispatch.com/), 
  // they probably want to log in, so we redirect them away from the landing page to /login.
  if (isProduction && isAppDomain && url.pathname === '/') {
    return NextResponse.redirect(`https://app.ustowdispatch.com/login`);
  }

  return NextResponse.next();
}

export const config = {
  // Run middleware on all routes except API routes and static files
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
