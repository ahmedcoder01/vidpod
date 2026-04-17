import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

// Prevent connection storms during Next.js dev HMR — Next re-evaluates modules
// on every change, so a top-level `new PrismaClient()` would leak clients.
// Cache on globalThis so the same instance survives HMR.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Prisma 7 requires a driver adapter. `PrismaPg` wraps the `pg` pool.
const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL ?? 'postgresql://vidpod:vidpod-dev-pw@localhost:5432/vidpod',
});

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
