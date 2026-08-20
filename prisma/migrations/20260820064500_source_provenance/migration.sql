-- Source provenance for strategy versions.
--
-- A strategy version may now declare a public repository, pinned to a commit
-- SHA resolved once at registration. Both columns are nullable: disclosing no
-- source is a legitimate state the interface shows rather than penalises.

CREATE TYPE "ProvenanceState" AS ENUM ('VERIFIED', 'MISSING', 'MISMATCH', 'UNREACHABLE');

ALTER TABLE "strategy_versions" ADD COLUMN "repositoryUrl" TEXT;
ALTER TABLE "strategy_versions" ADD COLUMN "repositoryCommit" TEXT;

CREATE INDEX "strategy_versions_repositoryCommit_idx" ON "strategy_versions"("repositoryCommit");

-- Append-only, like every other record here. A scan is never updated in place:
-- a repository that was public in March and gone in August is exactly the fact
-- this table exists to preserve, and overwriting the March row would erase it.
CREATE TABLE "repository_scans" (
    "id" TEXT NOT NULL,
    "strategyVersionId" TEXT NOT NULL,
    "repository" TEXT NOT NULL,
    "commitSha" TEXT NOT NULL,
    "state" "ProvenanceState" NOT NULL,
    "checks" JSONB NOT NULL,
    "isPublic" BOOLEAN,
    "isArchived" BOOLEAN,
    "license" TEXT,
    "primaryLanguage" TEXT,
    "repoCreatedAt" TIMESTAMP(3),
    "lastPushedAt" TIMESTAMP(3),
    "stars" INTEGER,
    "note" TEXT,
    "scannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "repository_scans_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "repository_scans_strategyVersionId_idx" ON "repository_scans"("strategyVersionId");
CREATE INDEX "repository_scans_state_idx" ON "repository_scans"("state");
CREATE INDEX "repository_scans_scannedAt_idx" ON "repository_scans"("scannedAt");
CREATE INDEX "repository_scans_strategyVersionId_scannedAt_idx" ON "repository_scans"("strategyVersionId", "scannedAt");

ALTER TABLE "repository_scans" ADD CONSTRAINT "repository_scans_strategyVersionId_fkey"
    FOREIGN KEY ("strategyVersionId") REFERENCES "strategy_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
