import "dotenv/config";
import { defineConfig } from "prisma/config";

/**
 * Prisma 7 moved the datasource URL out of schema.prisma. Migration and
 * introspection commands read it from here; the runtime client gets its
 * connection through the pg adapter in lib/db.ts.
 *
 * This points at DIRECT_URL, not DATABASE_URL. DATABASE_URL is the
 * transaction-mode pooler (pgbouncer), where migrations hang forever: Prisma
 * takes a session-scoped advisory lock, and transaction pooling hands each
 * statement a different backend, so the lock is never observed as held.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL,
  },
});
