import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';
import { createPresignedAdUpload } from '@/lib/s3';

// POST /api/ads/upload-init
// Body: { title, advertiser?, campaign?, duration?, tags?[], contentType? }
// Creates a `pending` Ad row and returns a presigned single-part PUT URL.
// The client uploads the MP4 straight to S3, then calls /upload-complete
// to flip the row to 'ready'. Pending ads are filtered out by GET /api/ads.
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const title = typeof body.title === 'string' ? body.title.trim().slice(0, 200) : '';
  if (!title) return NextResponse.json({ error: 'title is required' }, { status: 400 });

  const advertiser = typeof body.advertiser === 'string' ? body.advertiser.trim().slice(0, 200) : '';
  const campaign   = typeof body.campaign   === 'string' ? body.campaign.trim().slice(0, 200)   : '';
  const durationN  = Number(body.duration);
  const duration   = Number.isFinite(durationN) && durationN > 0 ? durationN : 0;
  const rawTags    = Array.isArray(body.tags) ? body.tags : [];
  const tags       = (rawTags as unknown[])
    .filter((t): t is string => typeof t === 'string')
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 20);
  const contentType = typeof body.contentType === 'string' && body.contentType
    ? body.contentType
    : 'video/mp4';

  // Create the pending row first so we have a canonical adId for the key.
  const ad = await prisma.ad.create({
    data: {
      title,
      advertiser,
      campaign,
      duration,
      tags: JSON.stringify(tags),
      status: 'pending',
      isPublicAd: false,
      uploaderId: user.id,
    },
    select: { id: true },
  });

  try {
    const { key, uploadUrl, requiredHeaders, publicUrl } = await createPresignedAdUpload({
      adId: ad.id,
      contentType,
      // Keys must be lowercase ASCII per S3.
      metadata: {
        'ad-id': ad.id,
        'uploader-id': user.id,
      },
    });

    // Persist the key + computed public URL now so the subsequent
    // upload-complete call is a cheap status flip, and so even if the
    // client never calls complete we can still reconcile later.
    await prisma.ad.update({
      where: { id: ad.id },
      data: { s3Key: key, videoUrl: publicUrl },
    });

    return NextResponse.json({
      adId: ad.id,
      key,
      uploadUrl,
      requiredHeaders,
    });
  } catch (err) {
    // Roll back the pending row so we don't leak rows on presign errors.
    await prisma.ad.delete({ where: { id: ad.id } }).catch(() => undefined);
    const msg = err instanceof Error ? err.message : 'Failed to presign ad upload';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
