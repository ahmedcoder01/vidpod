import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// Prisma 7 config. The Prisma CLI reads DATABASE_URL from here for `migrate`,
// `studio`, etc. Runtime (`src/lib/prisma.ts`, `prisma/seed.ts`) uses the
// default Postgres connection (no adapter).
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
