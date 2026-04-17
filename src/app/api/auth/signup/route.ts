import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { hashPassword, signSession, setSessionCookie } from '@/lib/auth';

function badRequest(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return badRequest('Invalid body');

  const name = (body.name ?? '').toString().trim();
  const email = (body.email ?? '').toString().trim().toLowerCase();
  const password = (body.password ?? '').toString();

  if (!name) return badRequest('Name is required');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return badRequest('Invalid email');
  if (password.length < 8) return badRequest('Password must be at least 8 characters');

  const passwordHash = await hashPassword(password);

  try {
    const user = await prisma.user.create({
      data: { name, email, passwordHash },
      select: { id: true, email: true, name: true, avatar: true },
    });

    const token = await signSession(user);
    await setSessionCookie(token);

    return NextResponse.json({ user }, { status: 201 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return badRequest('An account with that email already exists', 409);
    }
    throw err;
  }
}
