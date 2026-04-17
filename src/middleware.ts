import { NextResponse, type NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

const COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? 'vp_session';
const SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET ?? 'dev-only-rotate-me-in-env',
);
const ISSUER = process.env.JWT_ISSUER ?? 'vidpod';

// Runs on the edge. We only do a cheap JWT signature check here — DB lookups
// happen in the actual route. If the token is missing/invalid on a protected
// page, bounce to /login. If a signed-in user hits /login or /signup, send
// them on to the dashboard.
const PUBLIC_PATHS = new Set(['/login', '/signup']);

async function isValidToken(token: string | undefined) {
  if (!token) return false;
  try {
    await jwtVerify(token, SECRET, { issuer: ISSUER, algorithms: ['HS256'] });
    return true;
  } catch {
    return false;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const token = req.cookies.get(COOKIE_NAME)?.value;
  const authed = await isValidToken(token);

  if (PUBLIC_PATHS.has(pathname)) {
    if (authed) {
      const url = req.nextUrl.clone();
      url.pathname = '/dashboard';
      url.search = '';
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  if (!authed) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

// Run on everything except API routes, Next internals, static files and the
// root redirect. The root `/` page handles its own redirect already.
export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|$).*)',
  ],
};
