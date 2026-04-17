import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';
import { abortMultipartUpload } from '@/lib/s3';

// POST /api/videos/[id]/upload-abort
// Body: { uploadId, key }
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
  if (!uploadId || !key) {
    return NextResponse.json({ error: 'Missing uploadId / key' }, { status: 400 });
  }

  // Ownership gate — only the podcast owner can abort their own upload.
  const video = await prisma.video.findFirst({
    where: { id, podcast: { ownerId: user.id } },
    select: { id: true, status: true },
  });
  if (!video) return NextResponse.json({ error: 'Video not found' }, { status: 404 });

  // Fire-and-forget the S3 abort; swallow errors so we still drop the pending
  // row. S3 garbage-collects orphaned multipart uploads on its own lifecycle.
  try {
    await abortMultipartUpload({ key, uploadId });
  } catch {
    // ignore — the Video deletion below is the important cleanup.
  }

  // Only delete pending rows via abort. Once the upload is complete, a video
  // is managed through its own DELETE endpoint (future work).
  if (video.status === 'pending') {
    await prisma.video.delete({ where: { id } });
  }

  return NextResponse.json({ ok: true });
}
