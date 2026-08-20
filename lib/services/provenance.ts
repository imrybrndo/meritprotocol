/**
 * Source provenance for strategy versions.
 *
 * Two operations, and the difference between them matters.
 *
 * `freezeRepository` runs once, when a version is registered. It resolves the
 * URL an operator supplied to a full commit SHA and stores that. From then on
 * the version points at fixed content: pushing to the branch afterwards cannot
 * retroactively change what a past decision was made under.
 *
 * `scanVersion` runs repeatedly. It asks whether the repository is still there
 * and still contains that commit. This is the half that catches an agent
 * quietly deleting or privatising its source after a bad month — an event that
 * currently leaves no trace anywhere in the protocol.
 *
 * Every check is reported individually, in the same shape as the verification
 * report, and a scan with anything unresolved is never rendered as a clean
 * pass. None of it touches the MERIT score.
 */

import type { PrismaClient, Prisma } from "../generated/prisma/client";
import {
  commitPresent,
  commitUrl,
  fetchRepository,
  isCommitSha,
  parseRepositoryUrl,
  resolveCommit,
  type RepositoryFacts,
} from "../provenance/github";
import { ProtocolError } from "./decisions";

export type ProvenanceState = "VERIFIED" | "MISSING" | "MISMATCH" | "UNREACHABLE";

export type CheckId =
  | "REPOSITORY_RESOLVES"
  | "PUBLICLY_READABLE"
  | "COMMIT_PRESENT"
  | "COMMIT_PINNED"
  | "NOT_ARCHIVED";

export type CheckState = "PASS" | "FAIL" | "SKIPPED";

export interface ProvenanceCheck {
  id: CheckId;
  label: string;
  state: CheckState;
  detail: string;
}

const pass = (id: CheckId, label: string, detail: string): ProvenanceCheck => ({ id, label, state: "PASS", detail });
const fail = (id: CheckId, label: string, detail: string): ProvenanceCheck => ({ id, label, state: "FAIL", detail });
const skip = (id: CheckId, label: string, detail: string): ProvenanceCheck => ({ id, label, state: "SKIPPED", detail });

export interface FrozenRepository {
  repositoryUrl: string;
  repositoryCommit: string;
}

/**
 * Resolve an operator-supplied repository reference to a pinned commit.
 *
 * Throws rather than storing an unusable value: a URL that cannot be read now
 * will not become readable by being written to the database, and a version
 * registered against an unresolvable repository would be scanned forever
 * without ever having meant anything.
 */
export async function freezeRepository(
  url: string,
  gitRef?: string,
): Promise<FrozenRepository> {
  const ref = parseRepositoryUrl(url);
  if (!ref) {
    throw new ProtocolError(
      "Could not read that as a GitHub repository. Use a URL like https://github.com/owner/name.",
      "REPOSITORY_UNPARSEABLE",
      422,
    );
  }

  const resolved = await resolveCommit(ref, gitRef);
  if (!resolved.ok) {
    throw new ProtocolError(
      `Could not resolve ${ref.canonical}${gitRef ? ` at ${gitRef}` : ""}: ${resolved.note}`,
      resolved.kind === "missing" ? "REPOSITORY_NOT_FOUND" : "REPOSITORY_UNREACHABLE",
      resolved.kind === "missing" ? 422 : 503,
    );
  }

  return { repositoryUrl: ref.canonical, repositoryCommit: resolved.value };
}

export interface ScanResult {
  strategyVersionId: string;
  repository: string;
  commitSha: string;
  state: ProvenanceState;
  checks: ProvenanceCheck[];
  facts: RepositoryFacts | null;
  note: string | null;
  commitUrl: string;
  scannedAt: Date;
}

/**
 * Observe one strategy version's repository and record what was found.
 *
 * Returns null when the version declares no repository. That is a legitimate
 * state, not a failure: an agent is free to disclose no source, and the
 * interface shows the absence rather than inventing a scan for it.
 */
export async function scanVersion(
  prisma: PrismaClient,
  strategyVersionId: string,
): Promise<ScanResult | null> {
  const version = await prisma.strategyVersion.findUnique({
    where: { id: strategyVersionId },
    select: { id: true, repositoryUrl: true, repositoryCommit: true },
  });

  if (!version?.repositoryUrl || !version.repositoryCommit) return null;

  const ref = parseRepositoryUrl(version.repositoryUrl);
  const checks: ProvenanceCheck[] = [];

  if (!ref) {
    // Stored but unparseable. Only reachable for rows written before the
    // validation above existed, so it is recorded rather than thrown.
    checks.push(
      fail("REPOSITORY_RESOLVES", "Repository resolves", `Stored value is not a readable GitHub reference: ${version.repositoryUrl}`),
      skip("PUBLICLY_READABLE", "Publicly readable", "Not checked — the reference could not be parsed."),
      skip("COMMIT_PRESENT", "Commit present", "Not checked — the reference could not be parsed."),
      skip("NOT_ARCHIVED", "Repository active", "Not checked — the reference could not be parsed."),
    );

    return persist(prisma, {
      strategyVersionId: version.id,
      repository: version.repositoryUrl,
      commitSha: version.repositoryCommit,
      state: "MISSING",
      checks,
      facts: null,
      note: "Stored repository reference is unparseable.",
    });
  }

  checks.push(pass("REPOSITORY_RESOLVES", "Repository resolves", `Reads as ${ref.canonical}.`));

  checks.push(
    isCommitSha(version.repositoryCommit)
      ? pass("COMMIT_PINNED", "Commit pinned", `Version is pinned to ${version.repositoryCommit.slice(0, 12)}, which cannot change content without changing the SHA.`)
      : fail("COMMIT_PINNED", "Commit pinned", "Stored reference is not a full commit SHA, so it does not fix the content."),
  );

  const repo = await fetchRepository(ref);

  if (!repo.ok) {
    const unreachable = repo.kind === "unreachable";

    checks.push(
      unreachable
        ? skip("PUBLICLY_READABLE", "Publicly readable", repo.note)
        : fail("PUBLICLY_READABLE", "Publicly readable", repo.note),
      skip("COMMIT_PRESENT", "Commit present", "Not checked — the repository could not be read."),
      skip("NOT_ARCHIVED", "Repository active", "Not checked — the repository could not be read."),
    );

    return persist(prisma, {
      strategyVersionId: version.id,
      repository: ref.canonical,
      commitSha: version.repositoryCommit,
      // An unreachable host says nothing about the agent, so it is not recorded
      // as the agent's repository being gone. Conflating the two would let a
      // GitHub outage look like evidence against everyone at once.
      state: unreachable ? "UNREACHABLE" : "MISSING",
      checks,
      facts: null,
      note: repo.note,
    });
  }

  const facts = repo.value;

  checks.push(
    facts.isPublic
      ? pass("PUBLICLY_READABLE", "Publicly readable", "Anyone can read this repository without MERIT's help.")
      : fail("PUBLICLY_READABLE", "Publicly readable", "Repository is private. It was read with a configured token, so the public cannot verify it."),
  );

  checks.push(
    facts.isArchived
      ? fail("NOT_ARCHIVED", "Repository active", "Repository is archived and read-only.")
      : pass("NOT_ARCHIVED", "Repository active", "Repository is not archived."),
  );

  const present = await commitPresent(ref, version.repositoryCommit);

  if (!present.ok) {
    checks.push(skip("COMMIT_PRESENT", "Commit present", present.note));
    return persist(prisma, {
      strategyVersionId: version.id,
      repository: ref.canonical,
      commitSha: version.repositoryCommit,
      state: "UNREACHABLE",
      checks,
      facts,
      note: present.note,
    });
  }

  checks.push(
    present.value
      ? pass("COMMIT_PRESENT", "Commit present", "The pinned commit is still in this repository.")
      : fail("COMMIT_PRESENT", "Commit present", "The pinned commit is no longer in this repository. It was force-pushed away, or the history was rewritten."),
  );

  const failed = checks.some((check) => check.state === "FAIL");

  return persist(prisma, {
    strategyVersionId: version.id,
    repository: ref.canonical,
    commitSha: version.repositoryCommit,
    state: !present.value ? "MISMATCH" : failed ? "MISSING" : "VERIFIED",
    checks,
    facts,
    note: null,
  });
}

interface PersistInput {
  strategyVersionId: string;
  repository: string;
  commitSha: string;
  state: ProvenanceState;
  checks: ProvenanceCheck[];
  facts: RepositoryFacts | null;
  note: string | null;
}

async function persist(prisma: PrismaClient, input: PersistInput): Promise<ScanResult> {
  const row = await prisma.repositoryScan.create({
    data: {
      strategyVersionId: input.strategyVersionId,
      repository: input.repository,
      commitSha: input.commitSha,
      state: input.state,
      checks: input.checks as unknown as Prisma.InputJsonValue,
      isPublic: input.facts?.isPublic ?? null,
      isArchived: input.facts?.isArchived ?? null,
      license: input.facts?.license ?? null,
      primaryLanguage: input.facts?.primaryLanguage ?? null,
      repoCreatedAt: input.facts?.createdAt ?? null,
      lastPushedAt: input.facts?.pushedAt ?? null,
      stars: input.facts?.stars ?? null,
      note: input.note,
    },
  });

  return {
    strategyVersionId: input.strategyVersionId,
    repository: input.repository,
    commitSha: input.commitSha,
    state: input.state,
    checks: input.checks,
    facts: input.facts,
    note: input.note,
    commitUrl: commitUrl(input.repository, input.commitSha),
    scannedAt: row.scannedAt,
  };
}

export interface ScanRunResult {
  scanned: number;
  verified: number;
  /** Versions whose repository stopped verifying since the previous scan. */
  regressions: Array<{ strategyVersionId: string; repository: string; from: ProvenanceState; to: ProvenanceState }>;
}

/**
 * Scan every version that declares a repository.
 *
 * Sequential and rate-limit aware: unauthenticated GitHub allows 60 requests an
 * hour and each version costs two, so a run without `GITHUB_TOKEN` is capped
 * well below that rather than burning the budget and reporting the rest as
 * UNREACHABLE — which would look like evidence against agents who did nothing.
 */
export async function scanAllVersions(
  prisma: PrismaClient,
  options: { limit?: number } = {},
): Promise<ScanRunResult> {
  const budget = process.env.GITHUB_TOKEN?.trim() ? 500 : 20;
  const limit = Math.min(options.limit ?? budget, budget);

  const versions = await prisma.strategyVersion.findMany({
    where: { repositoryUrl: { not: null }, repositoryCommit: { not: null } },
    // Least recently scanned first, so a capped run still works through the
    // whole set across successive runs instead of re-scanning the same head.
    orderBy: { scans: { _count: "asc" } },
    take: limit,
    select: {
      id: true,
      scans: { orderBy: { scannedAt: "desc" }, take: 1, select: { state: true } },
    },
  });

  const regressions: ScanRunResult["regressions"] = [];
  let scanned = 0;
  let verified = 0;

  for (const version of versions) {
    const previous = version.scans[0]?.state as ProvenanceState | undefined;
    const result = await scanVersion(prisma, version.id);
    if (!result) continue;

    scanned += 1;
    if (result.state === "VERIFIED") verified += 1;

    if (previous === "VERIFIED" && result.state !== "VERIFIED") {
      regressions.push({
        strategyVersionId: version.id,
        repository: result.repository,
        from: previous,
        to: result.state,
      });
    }
  }

  return { scanned, verified, regressions };
}

export interface ProvenanceView {
  repository: string;
  commitSha: string;
  commitUrl: string;
  state: ProvenanceState;
  checks: ProvenanceCheck[];
  license: string | null;
  primaryLanguage: string | null;
  repoCreatedAt: Date | null;
  lastPushedAt: Date | null;
  stars: number | null;
  note: string | null;
  scannedAt: Date;
}

/** The most recent scan for a strategy version, or null if never scanned. */
export async function latestScan(
  prisma: PrismaClient,
  strategyVersionId: string,
): Promise<ProvenanceView | null> {
  const row = await prisma.repositoryScan.findFirst({
    where: { strategyVersionId },
    orderBy: { scannedAt: "desc" },
  });
  if (!row) return null;

  return {
    repository: row.repository,
    commitSha: row.commitSha,
    commitUrl: commitUrl(row.repository, row.commitSha),
    state: row.state as ProvenanceState,
    checks: row.checks as unknown as ProvenanceCheck[],
    license: row.license,
    primaryLanguage: row.primaryLanguage,
    repoCreatedAt: row.repoCreatedAt,
    lastPushedAt: row.lastPushedAt,
    stars: row.stars,
    note: row.note,
    scannedAt: row.scannedAt,
  };
}

/** Full scan history for a version, newest first. The disappearance trail. */
export async function scanHistory(
  prisma: PrismaClient,
  strategyVersionId: string,
  limit = 50,
): Promise<ProvenanceView[]> {
  const rows = await prisma.repositoryScan.findMany({
    where: { strategyVersionId },
    orderBy: { scannedAt: "desc" },
    take: Math.min(limit, 200),
  });

  return rows.map((row) => ({
    repository: row.repository,
    commitSha: row.commitSha,
    commitUrl: commitUrl(row.repository, row.commitSha),
    state: row.state as ProvenanceState,
    checks: row.checks as unknown as ProvenanceCheck[],
    license: row.license,
    primaryLanguage: row.primaryLanguage,
    repoCreatedAt: row.repoCreatedAt,
    lastPushedAt: row.lastPushedAt,
    stars: row.stars,
    note: row.note,
    scannedAt: row.scannedAt,
  }));
}
