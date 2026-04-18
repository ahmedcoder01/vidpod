import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';

// DELETE /api/ads/[id] — remove an ad the user uploaded. Public/platform
// ads are never deletable by a regular user. Any AdMarkerAd rows pointing
// at this ad cascade via the Prisma relation (@relation onDelete: Cascade).
// The S3 object is left behind intentionally — cheap, and avoids a race
// where an in-flight <video> request 404s mid-playback.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const ad = await prisma.ad.findFirst({
    where: { id, uploaderId: user.id, isPublicAd: false },
    select: { id: true },
  });
  if (!ad) return NextResponse.json({ error: 'Ad not found' }, { status: 404 });

  await prisma.ad.delete({ where: { id: ad.id } });
  return NextResponse.json({ ok: true });
}
