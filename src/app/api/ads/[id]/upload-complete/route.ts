import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';
import { completeMultipartUploadWithParts } from '@/lib/s3';

// POST /api/ads/[id]/upload-complete
// Body: { uploadId, key, parts: [{ partNumber, etag }, ...], duration? }
//
// Trust model:
//   The client can't fake a completion. `CompleteMultipartUpload` fails at
//   the S3 layer if the parts don't exist or their ETags don't match, and
//   the caller can only upload parts to keys the server presigned for them
//   via /upload-init. So even though the client triggers this endpoint,
//   the finalize is cryptographic and any lie is rejected by S3 before we
//   flip the DB row to 'ready'.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const uploadId = (body.uploadId ?? '').toString();
  const key = (body.key ?? '').toString();
  const parts = Array.isArray(body.parts) ? body.parts : null;
  if (!uploadId || !key || !parts || parts.length === 0) {
    return NextResponse.json({ error: 'Missing uploadId / key / parts' }, { status: 400 });
  }

  // Normalize + validate — the transport could reshape these.
  const normalizedParts: { partNumber: number; etag: string }[] = [];
  for (const p of parts) {
    const partNumber = Number(p.partNumber);
    const etag = (p.etag ?? '').toString();
    if (!Number.isInteger(partNumber) || partNumber < 1 || !etag) {
      return NextResponse.json({ error: 'Invalid part entry' }, { status: 400 });
    }
    normalizedParts.push({ partNumber, etag });
  }

  const ad = await prisma.ad.findFirst({
    where: { id, uploaderId: user.id },
    select: { id: true, s3Key: true, status: true, duration: true },
  });
  if (!ad) return NextResponse.json({ error: 'Ad not found' }, { status: 404 });
  if (!ad.s3Key) {
    return NextResponse.json({ error: 'Ad has no pending upload' }, { status: 409 });
  }
  // Defense-in-depth: refuse to finalize against a key the server didn't
  // presign for this ad (stale client with mismatched init response).
  if (ad.s3Key !== key) {
    return NextResponse.json({ error: 'Key does not match pending upload' }, { status: 409 });
  }

  // Idempotency: if another request already finalized this row, don't
  // re-call S3 — CompleteMultipartUpload is not safe to retry after success
  // (S3 returns `NoSuchUpload` on the second call). Return the current row.
  if (ad.status !== 'pending') {
    const existing = await prisma.ad.findUnique({
      where: { id },
      select: {
        id: true, title: true, advertiser: true, campaign: true,
        duration: true, thumbnail: true, videoUrl: true, tags: true,
      },
    });
    return NextResponse.json(existing ? { ...existing, tags: safeParseTags(existing.tags) } : null);
  }

  try {
    await completeMultipartUploadWithParts({ key, uploadId, parts: normalizedParts });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'S3 completion failed';
    return NextResponse.json({ error: message }, { status: 502 });
  }

  // Pull an optional duration from the client. Only override if we don't
  // already have a positive value from init — keeps the init-provided
  // duration authoritative when the client sent it up front.
  let nextDuration = ad.duration;
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
