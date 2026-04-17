import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

// Prevent connection storms during Next.js dev HMR — Next re-evaluates modules
// on every change, so a top-level `new PrismaClient()` would leak clients.
// Cache on globalThis so the same instance survives HMR.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// Prisma 7 requires a driver adapter. The SQLite adapter opens the local file
// directly via `better-sqlite3`. The path here is resolved from the process
// cwd, which (during dev + seed + build) is the project root.
const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL ?? 'file:./prisma/dev.db',
});

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
