import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';

// GET /api/me/podcasts — list the podcasts owned by the signed-in user.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const podcasts = await prisma.podcast.findMany({
    where: { ownerId: user.id },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      title: true,
      description: true,
      coverArt: true,
      initials: true,
      coverGradient: true,
      createdAt: true,
    },
  });
  return NextResponse.json(podcasts);
}

// POST /api/me/podcasts — create a new podcast owned by the signed-in user.
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const title = (body.title ?? '').toString().trim();
  if (!title) return NextResponse.json({ error: 'Title is required' }, { status: 400 });
  if (title.length > 120) {
    return NextResponse.json({ error: 'Title is too long (max 120)' }, { status: 400 });
  }

  const description = (body.description ?? '').toString().trim().slice(0, 1000);
  const initials = body.initials ? body.initials.toString().trim().slice(0, 4) : null;
  const coverGradient = body.coverGradient ? body.coverGradient.toString().slice(0, 80) : null;
  const coverArt = body.coverArt ? body.coverArt.toString() : null;

  const podcast = await prisma.podcast.create({
    data: {
      title,
      description,
      initials,
      coverGradient,
      coverArt,
      ownerId: user.id,
    },
    select: {
      id: true,
      title: true,
      description: true,
      coverArt: true,
      initials: true,
      coverGradient: true,
      createdAt: true,
    },
  });
  return NextResponse.json(podcast, { status: 201 });
}
