import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';
import {
  buildVideoObjectKey,
  createMultipartUploadWithParts,
  partCountFor,
  MAX_FILE_SIZE_BYTES,
} from '@/lib/s3';

// POST /api/videos/upload-init
// Body: { title, description?, episode?, filename, contentType, size }
// Header: X-Podcast-Id (or ?podcastId= fallback)
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const headerPodcast = req.headers.get('x-podcast-id');
  const queryPodcast = new URL(req.url).searchParams.get('podcastId');
  const podcastId = (headerPodcast || queryPodcast || '').trim();
  if (!podcastId) {
    return NextResponse.json({ error: 'Missing podcast scope' }, { status: 400 });
  }

  const owned = await prisma.podcast.findFirst({
    where: { id: podcastId, ownerId: user.id },
    select: { id: true },
  });
  if (!owned) return NextResponse.json({ error: 'Podcast not found' }, { status: 404 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const title = (body.title ?? '').toString().trim();
  const description = (body.description ?? '').toString().trim().slice(0, 2000);
  const episode = body.episode ? body.episode.toString().trim().slice(0, 40) : null;
  const filename = (body.filename ?? '').toString();
  const contentType = (body.contentType ?? '').toString();
  const size = Number(body.size);

  if (!title) return NextResponse.json({ error: 'Title is required' }, { status: 400 });
  if (title.length > 200) return NextResponse.json({ error: 'Title is too long' }, { status: 400 });
  if (!filename) return NextResponse.json({ error: 'Filename is required' }, { status: 400 });
  if (!contentType.startsWith('video/')) {
    return NextResponse.json({ error: 'Only video files are supported' }, { status: 400 });
  }
  if (!Number.isFinite(size) || size <= 0) {
    return NextResponse.json({ error: 'Invalid file size' }, { status: 400 });
  }
  if (size > MAX_FILE_SIZE_BYTES) {
    return NextResponse.json({ error: 'File is larger than 5 GiB' }, { status: 413 });
  }

  // Persist the pending Video first so we have a stable id to namespace the
  // S3 key under. author comes from the signed-in user's display name.
  const pending = await prisma.video.create({
    data: {
      title,
      description,
      episode,
      author: user.name,
      status: 'pending',
      podcastId,
      ownerId: user.id,
    },
    select: { id: true },
  });

  // Canonical key layout:
  //   videos/podcasts/{teamId}/{videoId}/{prefix}+full-podcast-video.mp4
  // teamId is the current user.id until a proper Team entity exists.
  // TODO: when Teams land, swap `user.id` for the user's `teamId`.
  const key = buildVideoObjectKey({ teamId: user.id, videoId: pending.id });

  let init;
  try {
    init = await createMultipartUploadWithParts({
      key,
      contentType,
      partCount: partCountFor(size),
      // Pre-set object metadata so the Go worker can correlate the S3 event
      // back to our DB row without reparsing the key. Keys must be lowercase
      // ASCII and values plain ASCII. S3 exposes these as `x-amz-meta-*` on
      // the resulting object.
      metadata: {
        'video-id': pending.id,
        'podcast-id': podcastId,
        'team-id': user.id,
        'uploader-id': user.id,
      },
    });
  } catch (err) {
    // Roll back the pending row if S3 says no — otherwise we leak orphan rows.
    await prisma.video.delete({ where: { id: pending.id } }).catch(() => undefined);
    const message = err instanceof Error ? err.message : 'S3 upload init failed';
    return NextResponse.json({ error: message }, { status: 502 });
  }

  return NextResponse.json(
    {
      videoId: pending.id,
      uploadId: init.uploadId,
      key: init.key,
      partSize: init.partSize,
      parts: init.parts,
    },
    { status: 201 },
  );
}
