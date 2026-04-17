import 'server-only';
import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { cookies } from 'next/headers';
import { prisma } from './prisma';

// ─── Env ─────────────────────────────────────────────────────────────────
// Fall back to a dev-only constant so local bootstrap never crashes, but the
// value in .env MUST be replaced before any deployment.
const SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET ?? 'dev-only-rotate-me-in-env',
);
const ISSUER = process.env.JWT_ISSUER ?? 'vidpod';
export const COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? 'vp_session';

// 7 days. Short enough to limit damage, long enough to not force daily logins.
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7;

const BCRYPT_ROUNDS = 11;

// ─── Passwords ───────────────────────────────────────────────────────────
export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// ─── JWT ─────────────────────────────────────────────────────────────────
export interface SessionClaims extends JWTPayload {
  sub: string;   // user id
  email: string;
  name: string;
}

export async function signSession(user: { id: string; email: string; name: string }): Promise<string> {
  return new SignJWT({ email: user.email, name: user.name })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_TTL_SECONDS}s`)
    .sign(SECRET);
}

export async function verifySession(token: string): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify<SessionClaims>(token, SECRET, {
      issuer: ISSUER,
      algorithms: ['HS256'],
    });
    return payload;
  } catch {
    return null;
  }
}

// ─── Cookie helpers (server-only) ────────────────────────────────────────
export async function setSessionCookie(token: string) {
  const jar = await cookies();
  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: TOKEN_TTL_SECONDS,
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.set(COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });
}

export async function getSessionClaims(): Promise<SessionClaims | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySession(token);
}

// ─── Current user loader (server-only) ───────────────────────────────────
export async function getCurrentUser() {
  const claims = await getSessionClaims();
  if (!claims?.sub) return null;
  const user = await prisma.user.findUnique({
    where: { id: claims.sub },
    select: { id: true, email: true, name: true, avatar: true, createdAt: true },
  });
  return user;
}
