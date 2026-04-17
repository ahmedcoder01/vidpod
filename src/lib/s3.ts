import 'server-only';
import {
  S3Client,
  CreateMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  UploadPartCommand,
  type CompletedPart,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// ─── Env ──────────────────────────────────────────────────────────────
const REGION = process.env.AWS_REGION;
const BUCKET = process.env.AWS_S3_BUCKET;
const ACCESS_KEY = process.env.AWS_ACCESS_KEY_ID;
const SECRET_KEY = process.env.AWS_SECRET_ACCESS_KEY;

const UPLOAD_PREFIX = (process.env.AWS_S3_UPLOAD_PREFIX ?? 'videos/').replace(/^\/+|\/+$/g, '') + '/';
const PUBLIC_URL_BASE = (process.env.AWS_S3_PUBLIC_URL_BASE ?? '').replace(/\/+$/, '');

function requireEnv(): void {
  if (!REGION || !BUCKET || !ACCESS_KEY || !SECRET_KEY) {
    throw new Error(
      'S3 env is incomplete. Please set AWS_REGION, AWS_S3_BUCKET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY in .env',
    );
  }
}

// ─── Client (singleton, survives dev HMR) ─────────────────────────────
const globalForS3 = globalThis as unknown as { s3Client?: S3Client };

function client(): S3Client {
  requireEnv();
  if (!globalForS3.s3Client) {
    globalForS3.s3Client = new S3Client({
      region: REGION!,
      credentials: { accessKeyId: ACCESS_KEY!, secretAccessKey: SECRET_KEY! },
    });
  }
  return globalForS3.s3Client;
}

// ─── Constants ────────────────────────────────────────────────────────
export const PART_SIZE_BYTES = 5 * 1024 * 1024; // 5 MiB — S3's minimum, except the last part.
export const MAX_PART_COUNT = 10_000;            // S3 hard cap.
export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024 * 1024; // 5 GiB — safe upper bound for this phase.
const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour — enough time for slow connections.

// The backend processing workflow triggers on keys ending with this exact
// suffix — keep it canonical across every upload.
export const OBJECT_FILENAME_SUFFIX = 'full-podcast-video.mp4';

// Hard-coded path segment that sits between the env-driven upload prefix
// (default "videos/") and the team scope. The Go worker expects this layout:
//   videos/podcasts/{teamId}/{videoId}/{prefix}+{suffix}
const PODCASTS_SEGMENT = 'podcasts/';

/**
 * Build the canonical S3 object key for a video upload.
 *
 * Format:  {UPLOAD_PREFIX}podcasts/{teamId}/{videoId}/{prefix}+{OBJECT_FILENAME_SUFFIX}
 * Example: videos/podcasts/u1/cmo3abc…/cmo3abc0x7+full-podcast-video.mp4
 *
 * - `teamId` scopes per-tenant. Today we pass `user.id` (see upload-init);
 *   when a Team entity lands this becomes `user.teamId`.
 * - `videoId` (cuid) guarantees the path is collision-free — re-uploading
 *   the same source file produces a new Video row and therefore a new key.
 * - The `{prefix}+` on the filename is an extra uniqueness tag required by
 *   the worker's filename convention. A 10-char slice of the cuid is plenty
 *   (cuids are globally unique, so any prefix of one already is).
 */
export function buildVideoObjectKey(args: {
  teamId: string;
  videoId: string;
}): string {
  const prefix = args.videoId.slice(0, 10);
  return (
    `${UPLOAD_PREFIX}${PODCASTS_SEGMENT}` +
    `${args.teamId}/${args.videoId}/${prefix}+${OBJECT_FILENAME_SUFFIX}`
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────
export function publicUrlFor(key: string): string {
  if (PUBLIC_URL_BASE) return `${PUBLIC_URL_BASE}/${key}`;
  // Virtual-hosted–style URL works for all regions Prisma cares about.
  return `https://${BUCKET}.s3.${REGION}.amazonaws.com/${key}`;
}

export function partCountFor(sizeBytes: number): number {
  if (sizeBytes <= 0) return 1;
  const parts = Math.ceil(sizeBytes / PART_SIZE_BYTES);
  return Math.max(1, Math.min(parts, MAX_PART_COUNT));
}

export interface PresignedPart {
  partNumber: number;
  url: string;
}

export interface StartMultipartResult {
  uploadId: string;
  key: string;
  partSize: number;
  parts: PresignedPart[];
}

export async function createMultipartUploadWithParts(args: {
  key: string;
  contentType: string;
  partCount: number;
  /**
   * Object metadata saved as `x-amz-meta-*` headers. Sent once on the
   * multipart init — survives through to the final object, so the Go worker
   * can pull them via `HeadObject` without re-parsing the key path.
   *
   * Keys must be lowercase ASCII. Values must be ASCII (URL-encode otherwise).
   * Combined key+value size must stay under ~2 KiB per object (S3 limit).
   */
  metadata?: Record<string, string>;
}): Promise<StartMultipartResult> {
  const c = client();
  const { UploadId } = await c.send(
    new CreateMultipartUploadCommand({
      Bucket: BUCKET!,
      Key: args.key,
      ContentType: args.contentType,
      Metadata: args.metadata,
    }),
  );
  if (!UploadId) throw new Error('S3 did not return an UploadId');

  const parts: PresignedPart[] = [];
  for (let i = 1; i <= args.partCount; i++) {
    const url = await getSignedUrl(
      c,
      new UploadPartCommand({
        Bucket: BUCKET!,
        Key: args.key,
        UploadId,
        PartNumber: i,
      }),
      { expiresIn: SIGNED_URL_TTL_SECONDS },
    );
    parts.push({ partNumber: i, url });
  }

  return { uploadId: UploadId, key: args.key, partSize: PART_SIZE_BYTES, parts };
}

export async function completeMultipartUploadWithParts(args: {
  key: string;
  uploadId: string;
  parts: { partNumber: number; etag: string }[];
}): Promise<void> {
  const c = client();
  const completed: CompletedPart[] = [...args.parts]
    .sort((a, b) => a.partNumber - b.partNumber)
    .map((p) => ({ PartNumber: p.partNumber, ETag: p.etag }));
  await c.send(
    new CompleteMultipartUploadCommand({
      Bucket: BUCKET!,
      Key: args.key,
      UploadId: args.uploadId,
      MultipartUpload: { Parts: completed },
    }),
  );
}

export async function abortMultipartUpload(args: { key: string; uploadId: string }): Promise<void> {
  const c = client();
  await c.send(
    new AbortMultipartUploadCommand({
      Bucket: BUCKET!,
      Key: args.key,
      UploadId: args.uploadId,
    }),
  );
}

