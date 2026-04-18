import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';
import { abortMultipartUpload } from '@/lib/s3';

// POST /api/ads/[id]/upload-abort
// Body: { uploadId, key }
// Fires S3 AbortMultipartUpload and drops the pending Ad row so we don't
// leak orphan library entries. Safe to call from the UI when the user hits
// "Cancel upload" — idempotent for already-completed rows (they're left
// alone; only `pending` rows get deleted).
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

  const ad = await prisma.ad.findFirst({
    where: { id, uploaderId: user.id },
    select: { id: true, status: true },
  });
  if (!ad) return NextResponse.json({ error: 'Ad not found' }, { status: 404 });

  // Fire-and-forget the S3 abort; swallow errors so we still drop the
  // pending row. S3 GCs orphaned multipart uploads via its lifecycle rules.
  try {
    await abortMultipartUpload({ key, uploadId });
  } catch {
    // ignore — the row deletion below is the important cleanup.
  }

  if (ad.status === 'pending') {
    await prisma.ad.delete({ where: { id } });
  }

  return NextResponse.json({ ok: true });
}
