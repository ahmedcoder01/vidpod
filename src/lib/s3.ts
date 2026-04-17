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

export const UPLOAD_PREFIX = (process.env.AWS_S3_UPLOAD_PREFIX ?? 'videos/').replace(/^\/+|\/+$/g, '') + '/';
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
}): Promise<StartMultipartResult> {
  const c = client();
  const { UploadId } = await c.send(
    new CreateMultipartUploadCommand({
      Bucket: BUCKET!,
      Key: args.key,
      ContentType: args.contentType,
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

// Sanitize a filename so it's safe as part of an S3 object key. Keeps the
// extension, replaces anything else with `_`. S3 accepts most characters but
// signed URLs + CORS tend to be fussier.
export function sanitizeFilename(name: string): string {
  const lastDot = name.lastIndexOf('.');
  const base = (lastDot > 0 ? name.slice(0, lastDot) : name)
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);
  const ext = (lastDot > 0 ? name.slice(lastDot + 1) : '').replace(/[^a-zA-Z0-9]+/g, '').slice(0, 10);
  const safeBase = base || 'video';
  return ext ? `${safeBase}.${ext}` : safeBase;
}
