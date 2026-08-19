/**
 * Prisma client singleton.
 *
 * Next dev reloads modules on every edit; without the global cache each reload
 * would open a new pool and exhaust the database's connection limit.
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";

declare global {
  var __meritPrisma: PrismaClient | undefined;
}

export class DatabaseNotConfiguredError extends Error {
  constructor() {
    super(
      "DATABASE_URL is not set. Copy .env.example to .env and point it at your Postgres instance.",
    );
    this.name = "DatabaseNotConfiguredError";
  }
}

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new DatabaseNotConfiguredError();

  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

export function getPrisma(): PrismaClient {
  globalThis.__meritPrisma ??= createClient();
  return globalThis.__meritPrisma;
}

/** True when a database connection string is configured at all. */
export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

/**
 * Proxy so call sites can `import { prisma }` without forcing a connection at
 * module load — which would break `next build` when no database is reachable.
 */
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, property) {
    return Reflect.get(getPrisma(), property);
  },
});
