/**
 * Issue an API credential.
 *
 * This is the only way a key enters the system. `generateApiKey` returns the
 * plaintext exactly once and the database keeps nothing but its SHA-256 digest,
 * so the value printed here cannot be recovered afterwards — losing it means
 * issuing a new key, not looking the old one up.
 *
 * The owning user is upserted by email. Re-running for the same email adds
 * another key to that user rather than replacing the existing one, because
 * revoking a live credential should be a deliberate act, not a side effect of
 * issuing its successor.
 *
 *   npm run key:create -- --email you@example.com
 *   npm run key:create -- --email you@example.com --name "CI" --scopes decisions:write
 *   npm run key:create -- --email you@example.com --env test --expires-days 30
 */

import "dotenv/config";
import { parseArgs } from "node:util";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client";
import { generateApiKey } from "../lib/api/auth";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

/** Every scope the API enforces. Keep in step with the requireScope call sites. */
const KNOWN_SCOPES = [
  "agents:write",
  "strategies:write",
  "decisions:write",
  "outcomes:write",
  "batches:write",
] as const;

function usage(message: string): never {
  console.error(
    `${message}\n\n` +
      `Usage:\n` +
      `  npm run key:create -- --email <address> [options]\n\n` +
      `Options:\n` +
      `  --email          Owner email. Created if it does not exist. Required.\n` +
      `  --name           Label for the key. Default: "Default key".\n` +
      `  --scopes         Comma-separated. Default: all.\n` +
      `                   ${KNOWN_SCOPES.join(", ")}\n` +
      `  --env            live | test. Default: live.\n` +
      `  --expires-days   Expiry in days. Default: never.\n`,
  );
  process.exit(1);
}

async function main() {
  const { values } = parseArgs({
    options: {
      email: { type: "string" },
      name: { type: "string" },
      scopes: { type: "string" },
      env: { type: "string" },
      "expires-days": { type: "string" },
    },
    allowPositionals: false,
  });

  const email = values.email?.trim();
  if (!email) usage("Missing --email.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) usage(`Not a valid email: ${email}`);

  const environment = (values.env ?? "live").trim();
  if (environment !== "live" && environment !== "test") {
    usage(`--env must be "live" or "test", got "${environment}".`);
  }

  const scopes = values.scopes
    ? values.scopes.split(",").map((scope) => scope.trim()).filter(Boolean)
    : [...KNOWN_SCOPES];

  // A typo in a scope is silent at issue time and only surfaces as a 403 much
  // later, so reject unknown scopes here rather than minting a broken key.
  const unknown = scopes.filter(
    (scope) => scope !== "*" && !KNOWN_SCOPES.includes(scope as (typeof KNOWN_SCOPES)[number]),
  );
  if (unknown.length > 0) usage(`Unknown scope(s): ${unknown.join(", ")}`);

  let expiresAt: Date | null = null;
  if (values["expires-days"]) {
    const days = Number(values["expires-days"]);
    if (!Number.isFinite(days) || days <= 0) {
      usage(`--expires-days must be a positive number, got "${values["expires-days"]}".`);
    }
    expiresAt = new Date(Date.now() + days * 86_400_000);
  }

  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email },
    select: { id: true, email: true, createdAt: true, updatedAt: true },
  });
  const isNewUser = user.createdAt.getTime() === user.updatedAt.getTime();

  const { key, prefix, keyHash } = generateApiKey(environment);

  await prisma.apiKey.create({
    data: {
      userId: user.id,
      prefix,
      keyHash,
      name: values.name?.trim() || "Default key",
      scopes,
      expiresAt,
    },
  });

  console.log(
    [
      "",
      `  API key issued${isNewUser ? " (new user created)" : ""}`,
      "",
      `  Owner    ${user.email}`,
      `  Label    ${values.name?.trim() || "Default key"}`,
      `  Scopes   ${scopes.join(", ")}`,
      `  Expires  ${expiresAt ? expiresAt.toISOString() : "never"}`,
      "",
      `  ${key}`,
      "",
      "  Shown once. Only its SHA-256 digest is stored, so it cannot be",
      "  recovered — save it now.",
      "",
      "  Use it as:",
      `    curl -H "Authorization: Bearer ${prefix}_…" http://localhost:3000/api/v1/agents`,
      "",
    ].join("\n"),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
