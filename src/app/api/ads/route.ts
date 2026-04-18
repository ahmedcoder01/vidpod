import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';
import { publicUrlFor } from '@/lib/s3';

// GET /api/ads — list every ad the signed-in user can use in their videos.
// Scope: ads they uploaded themselves OR platform-provided public ads
// (isPublicAd=true). Only `status='ready'` rows surface — pending uploads
// stay hidden until S3 confirms the object is in place.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const ads = await prisma.ad.findMany({
    where: {
      status: 'ready',
      OR: [
        { uploaderId: user.id },
        { isPublicAd: true },
      ],
    },
    orderBy: [
      { isPublicAd: 'desc' }, // platform ads first — reliable "something to show" in demos
      { createdAt: 'desc' },
    ],
    select: {
      id: true,
      title: true,
      advertiser: true,
      campaign: true,
      duration: true,
      thumbnail: true,
      videoUrl: true,
      s3Key: true,
      tags: true,
      isPublicAd: true,
    },
  });

  return NextResponse.json(
    ads.map((a) => ({
      id: a.id,
      title: a.title,
      advertiser: a.advertiser,
      campaign: a.campaign,
      duration: a.duration,
      thumbnail: a.thumbnail,
      // Prefer the derived public URL (keeps working if the env base
      // changes). Fall back to the stored videoUrl for legacy seed rows.
      videoUrl: a.s3Key ? publicUrlFor(a.s3Key) : a.videoUrl,
      tags: safeParseTags(a.tags),
      isPublicAd: a.isPublicAd,
    })),
  );
}

function safeParseTags(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}
