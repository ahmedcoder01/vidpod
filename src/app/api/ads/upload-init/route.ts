import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';
import {
  buildAdObjectKey,
  createMultipartUploadWithParts,
  partCountFor,
  publicUrlFor,
  MAX_FILE_SIZE_BYTES,
} from '@/lib/s3';

// POST /api/ads/upload-init
// Body: { title, advertiser?, campaign?, duration?, tags?[], contentType?, size }
// Creates a `pending` Ad row and starts an S3 multipart upload. Returns the
// UploadId + presigned part URLs so the browser can PUT chunks in parallel
// directly to S3. The caller finalizes via /api/ads/[id]/upload-complete,
// which hits S3's CompleteMultipartUpload — that step is cryptographically
// verified (part ETags must match), so a bad client can't fake a success.
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

  const size = Number(body.size);
  if (!Number.isFinite(size) || size <= 0) {
    return NextResponse.json({ error: 'Invalid file size' }, { status: 400 });
  }
  if (size > MAX_FILE_SIZE_BYTES) {
    return NextResponse.json({ error: 'File is larger than 5 GiB' }, { status: 413 });
  }

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

  const key = buildAdObjectKey(ad.id);

  try {
    const init = await createMultipartUploadWithParts({
      key,
      contentType,
      partCount: partCountFor(size),
      // Pre-set object metadata so orphans can be traced back to a row. Keys
      // must be lowercase ASCII per S3; values plain ASCII.
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
      data: { s3Key: key, videoUrl: publicUrlFor(key) },
    });

    return NextResponse.json(
      {
        adId: ad.id,
        uploadId: init.uploadId,
        key: init.key,
        partSize: init.partSize,
        parts: init.parts,
      },
      { status: 201 },
    );
  } catch (err) {
    // Roll back the pending row so we don't leak rows on presign errors.
    await prisma.ad.delete({ where: { id: ad.id } }).catch(() => undefined);
    const msg = err instanceof Error ? err.message : 'Failed to start ad upload';
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
