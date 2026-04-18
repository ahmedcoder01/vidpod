import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';

// GET /api/videos — list videos for the podcast specified in the
// `X-Podcast-Id` header (or ?podcastId=... query param as a fallback).
// Scoped to the signed-in user's podcasts so other users' data is never
// leaked, even if someone guesses an id.
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const headerId = req.headers.get('x-podcast-id');
  const queryId = new URL(req.url).searchParams.get('podcastId');
  const podcastId = (headerId || queryId || '').trim();
  if (!podcastId) {
    return NextResponse.json({ error: 'Missing podcast scope' }, { status: 400 });
  }

  // Confirm the podcast belongs to the current user before returning its videos.
  const owned = await prisma.podcast.findFirst({
    where: { id: podcastId, ownerId: user.id },
    select: { id: true },
  });
  if (!owned) {
    return NextResponse.json({ error: 'Podcast not found' }, { status: 404 });
  }

  const videos = await prisma.video.findMany({
    where: { podcastId },
    orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      title: true,
      description: true,
      author: true,
      status: true,
      episode: true,
      duration: true,
      thumbnail: true,
      chunksURL: true,
      createdAt: true,
      publishedAt: true,
      _count: { select: { adMarkers: true } },
    },
  });

  // Shape the response so the client gets `adMarkerCount` directly.
  return NextResponse.json(
    videos.map((v) => ({
      id: v.id,
      title: v.title,
      description: v.description,
      author: v.author,
      status: v.status,
      episode: v.episode,
      duration: v.duration,
      thumbnail: v.thumbnail,
      chunksURL: v.chunksURL,
      createdAt: v.createdAt,
      publishedAt: v.publishedAt,
      adMarkerCount: v._count.adMarkers,
    })),
  );
}
