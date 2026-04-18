import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';
import { adObjectExists } from '@/lib/s3';

// POST /api/ads/[id]/upload-complete
// Body (optional): { duration?: number } — the client can probe the final
// file's duration via <video>.duration and send it along; we trust it only
// if the DB row didn't already get it at init time.
// Verifies the S3 object exists, then flips status to 'ready' so the ad
// shows up in GET /api/ads. Returns the finalized Ad DTO.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  const ad = await prisma.ad.findFirst({
    where: { id, uploaderId: user.id },
    select: { id: true, s3Key: true, status: true, duration: true },
  });
  if (!ad) return NextResponse.json({ error: 'Ad not found' }, { status: 404 });
  if (!ad.s3Key) {
    return NextResponse.json({ error: 'Ad has no pending upload' }, { status: 409 });
  }

  const exists = await adObjectExists(ad.s3Key);
  if (!exists) {
    return NextResponse.json(
      { error: 'Upload object not found in S3 — did the PUT succeed?' },
      { status: 409 },
    );
  }

  // Pull an optional duration from the client. Only override if we don't
  // already have a positive value from init — keeps the init-provided
  // duration authoritative when the client sent it up front.
  let nextDuration = ad.duration;
  const body = await req.json().catch(() => ({}));
  if ((ad.duration ?? 0) <= 0) {
    const d = Number((body as { duration?: unknown }).duration);
    if (Number.isFinite(d) && d > 0) nextDuration = d;
  }

  const updated = await prisma.ad.update({
    where: { id: ad.id },
    data: {
      status: 'ready',
      duration: nextDuration,
    },
    select: {
      id: true, title: true, advertiser: true, campaign: true,
      duration: true, thumbnail: true, videoUrl: true, tags: true,
    },
  });

  return NextResponse.json({
    ...updated,
    tags: safeParseTags(updated.tags),
  });
}

function safeParseTags(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}
