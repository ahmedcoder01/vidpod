import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyPassword, signSession, setSessionCookie } from '@/lib/auth';

function badRequest(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return badRequest('Invalid body');

  const email = (body.email ?? '').toString().trim().toLowerCase();
  const password = (body.password ?? '').toString();
  if (!email || !password) return badRequest('Email and password are required');

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true, avatar: true, passwordHash: true },
  });

  // Constant-ish failure path: always run a compare to avoid leaking whether
  // the email exists via timing.
  const ok = user?.passwordHash
    ? await verifyPassword(password, user.passwordHash)
    : (await verifyPassword(password, '$2a$11$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv'), false);

  if (!user || !ok) return badRequest('Invalid email or password', 401);

  const token = await signSession(user);
  await setSessionCookie(token);

  const { passwordHash: _ph, ...safe } = user;
  return NextResponse.json({ user: safe });
}
