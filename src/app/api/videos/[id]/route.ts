import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';
import { keyFromFullS3Url, getPlaybackUrl } from '@/lib/s3';
import type { Transcript } from '@/lib/types';

// Shape returned by both GET and PATCH so the client can hot-swap state.
interface VideoDetailDto {
  id: string;
  title: string;
  description: string;
  author: string;
  episode: string | null;
  status: string;
  duration: number;
  thumbnail: string | null;
  fullS3Url: string | null;
  chunksURL: string | null;
  playbackUrl: string | null;
  waveformData: number[];
  transcript: Transcript | null;
  adMarkers: {
    id: string;
    type: string;
    startTime: number;
    label: string | null;
    adIds: string[];
  }[];
  createdAt: Date;
  publishedAt: Date | null;
  podcastId: string;
}

function safeParseArray<T = unknown>(raw: string): T[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

// Accepts the backend worker's shape { text, words: [{text,start,end,conf}] }.
// Anything missing/invalid → null so the UI treats it as "no transcript yet".
function safeParseTranscript(raw: string | null | undefined): Transcript | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    if (!v || typeof v !== 'object') return null;
    const text = typeof v.text === 'string' ? v.text : '';
    const rawWords: unknown = v.words;
    if (!Array.isArray(rawWords)) return null;
    const words = rawWords
      .filter(
        (w): w is { text: unknown; start: unknown; end: unknown; conf: unknown } =>
          !!w && typeof w === 'object',
      )
      .map((w) => ({
        text: typeof w.text === 'string' ? w.text : '',
        start: Number(w.start),
        end: Number(w.end),
        conf: Number(w.conf),
      }))
      .filter((w) => w.text && Number.isFinite(w.start) && Number.isFinite(w.end));
    return { text, words };
  } catch {
    return null;
  }
}

async function buildDto(
  video: Awaited<ReturnType<typeof prisma.video.findFirst>> & {
    transcript: string | null;
    adMarkers: {
      id: string;
      type: string;
      startTime: number;
      label: string | null;
      markerAds: { adId: string; position: number }[];
    }[];
  },
): Promise<VideoDetailDto> {
  // Playback URL: only mint when we actually have an S3 key to sign. A
  // pending video (status='pending', fullS3Url=null) returns null and the
  // UI shows its "video unavailable" state instead of a broken <video>.
  let playbackUrl: string | null = null;
  if (video.fullS3Url) {
    const key = keyFromFullS3Url(video.fullS3Url);
    if (key) {
      try {
        playbackUrl = await getPlaybackUrl(key);
      } catch {
        playbackUrl = null; // S3 error → UI shows "video unavailable"
      }
    }
  }

  return {
    id: video.id,
    title: video.title,
    description: video.description,
    author: video.author,
    episode: video.episode,
    status: video.status,
    duration: video.duration,
    thumbnail: video.thumbnail,
    fullS3Url: video.fullS3Url,
    chunksURL: video.chunksURL,
    playbackUrl,
    waveformData: safeParseArray<number>(video.waveformData),
    transcript: safeParseTranscript(video.transcript),
    adMarkers: video.adMarkers
      .map((m) => ({
        id: m.id,
        type: m.type,
        startTime: m.startTime,
        label: m.label,
        adIds: [...m.markerAds]
          .sort((a, b) => a.position - b.position)
          .map((x) => x.adId),
      }))
      .sort((a, b) => a.startTime - b.startTime),
    createdAt: video.createdAt,
    publishedAt: video.publishedAt,
    podcastId: video.podcastId,
  };
}

// ─── GET /api/videos/[id] ─────────────────────────────────────────────
// Returns the full video DTO for the owner, including a freshly signed
// playback URL and parsed waveformData / adMarkers.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const video = await prisma.video.findFirst({
    where: { id, podcast: { ownerId: user.id } },
    include: {
      adMarkers: {
        select: {
          id: true, type: true, startTime: true, label: true,
          markerAds: { select: { adId: true, position: true } },
        },
      },
    },
  });
  if (!video) return NextResponse.json({ error: 'Video not found' }, { status: 404 });

  return NextResponse.json(await buildDto(video));
}

// ─── PATCH /api/videos/[id] ───────────────────────────────────────────
// Body: { adMarkers?: [{ type, startTime, label?, adIds? }, ...] }
// Full replace for markers — per-video counts are small and the client
// already batches via a debounced save, so diffing isn't worth the effort.
// Ignores unknown fields; never allows the client to touch ownership/status.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  // Ownership gate before we touch anything.
  const existing = await prisma.video.findFirst({
    where: { id, podcast: { ownerId: user.id } },
    select: { id: true },
  });
  if (!existing) return NextResponse.json({ error: 'Video not found' }, { status: 404 });

  const rawMarkers = Array.isArray(body.adMarkers) ? body.adMarkers : null;

  if (rawMarkers) {
    // Validate + normalize each marker before touching the DB. We also
    // de-dupe adIds (the @@unique([markerId, adId]) would reject repeats).
    const normalized = rawMarkers.map((m: Record<string, unknown>) => {
      const type = (m.type ?? '').toString();
      const startTime = Number(m.startTime);
      if (!['static', 'auto', 'ab'].includes(type)) {
        throw Object.assign(new Error(`Invalid marker type "${type}"`), { status: 400 });
      }
      if (!Number.isFinite(startTime) || startTime < 0) {
        throw Object.assign(new Error('Invalid marker startTime'), { status: 400 });
      }
      const label = m.label != null ? String(m.label).slice(0, 120) : null;
      const rawIds = Array.isArray(m.adIds)
        ? m.adIds.filter((x: unknown): x is string => typeof x === 'string')
        : [];
      const adIds = Array.from(new Set(rawIds));
      return { type, startTime, label, adIds };
    });

    try {
      // Full replace. Transactional so a partial insert can't orphan markers.
      // Nested create for markerAds — createMany doesn't support nesting, so
      // we fan out one create per marker (per-video counts are small).
      await prisma.$transaction([
        prisma.adMarker.deleteMany({ where: { videoId: id } }),
        ...normalized.map((m: typeof normalized[number]) =>
          prisma.adMarker.create({
            data: {
              type: m.type,
              startTime: m.startTime,
              label: m.label,
              videoId: id,
              markerAds: {
                create: m.adIds.map((adId, idx) => ({ adId, position: idx })),
              },
            },
          }),
        ),
      ]);
    } catch (err) {
      const status = (err as { status?: number }).status ?? 500;
      const message = err instanceof Error ? err.message : 'Failed to save markers';
      return NextResponse.json({ error: message }, { status });
    }
  }

  // Re-read + build the DTO so the client gets the authoritative state
  // (including freshly ordered markers and a refreshed playback URL).
  const updated = await prisma.video.findFirst({
    where: { id },
    include: {
      adMarkers: {
        select: {
          id: true, type: true, startTime: true, label: true,
          markerAds: { select: { adId: true, position: true } },
        },
      },
    },
  });
  if (!updated) return NextResponse.json({ error: 'Video not found' }, { status: 404 });

  return NextResponse.json(await buildDto(updated));
}
