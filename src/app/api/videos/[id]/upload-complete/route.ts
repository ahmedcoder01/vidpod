import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';
import { completeMultipartUploadWithParts, publicUrlFor } from '@/lib/s3';

// POST /api/videos/[id]/upload-complete
// Body: { uploadId, key, parts: [{ partNumber, etag }, ...], duration? }
//
// Trust model:
//   The client CAN'T fake a completion. `CompleteMultipartUpload` fails at
//   the S3 layer if the parts don't exist or their ETags don't match, and
//   the caller can only upload parts to keys the server presigned for them
//   (which are scoped to their own podcasts via /upload-init). So even
//   though the client triggers this endpoint, the finalize is cryptographic
//   and any lie is rejected by S3 before we flip the DB row.
//
//   After S3 stitches the object, `ObjectCreated:CompleteMultipartUpload`
//   fires → the Go worker picks it up → transcodes → transitions the
//   status from `uploaded` to `chunking` → `completed`.
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
  const duration = Number(body.duration);
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

  // Ownership gate: the Video must belong to a podcast this user owns.
  const video = await prisma.video.findFirst({
    where: { id, podcast: { ownerId: user.id } },
    select: { id: true, status: true },
  });
  if (!video) return NextResponse.json({ error: 'Video not found' }, { status: 404 });

  // Idempotency: if another request already finalized this row, don't
  // re-call S3 — CompleteMultipartUpload is not safe to retry after success
  // (S3 will return `NoSuchUpload` on the second call). Return the current
  // row as-is.
  if (video.status !== 'pending') {
    const existing = await prisma.video.findUnique({
      where: { id },
      select: {
        id: true, title: true, description: true, author: true, status: true,
        episode: true, duration: true, thumbnail: true,
        createdAt: true, publishedAt: true, fullS3Url: true,
      },
    });
    return NextResponse.json(existing);
  }

  try {
    await completeMultipartUploadWithParts({ key, uploadId, parts: normalizedParts });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'S3 completion failed';
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const updated = await prisma.video.update({
    where: { id },
    data: {
      status: 'uploaded',
      fullS3Url: publicUrlFor(key),
      duration: Number.isFinite(duration) && duration > 0 ? duration : undefined,
      publishedAt: new Date(),
    },
    select: {
      id: true,
      title: true,
      description: true,
      author: true,
      status: true,
      episode: true,
      duration: true,
      thumbnail: true,
      createdAt: true,
      publishedAt: true,
      fullS3Url: true,
    },
  });

  return NextResponse.json(updated);
}
