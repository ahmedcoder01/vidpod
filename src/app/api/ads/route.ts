import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';

// GET /api/ads — list every ad available to the signed-in user.
// Ads are currently treated as a shared library visible to any authenticated
// user. Once per-podcast or per-workspace scoping is introduced, filter here.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const ads = await prisma.ad.findMany({
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      title: true,
      advertiser: true,
      campaign: true,
      duration: true,
      thumbnail: true,
      videoUrl: true,
      tags: true,
    },
  });

  // `tags` is stored as a JSON-encoded string (SQLite has no native array).
  // Parse it back so the frontend continues to get `string[]`.
  return NextResponse.json(
    ads.map((a) => ({
      ...a,
      tags: safeParseTags(a.tags),
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
