-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "AgentStatus" AS ENUM ('ACTIVE', 'PAUSED', 'RETIRED');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('UNVERIFIED', 'PENDING', 'VERIFIED', 'FAILED');

-- CreateEnum
CREATE TYPE "RiskProfile" AS ENUM ('CONSERVATIVE', 'MODERATE', 'AGGRESSIVE');

-- CreateEnum
CREATE TYPE "VersionStatus" AS ENUM ('ACTIVE', 'SUPERSEDED', 'RETIRED');

-- CreateEnum
CREATE TYPE "DecisionAction" AS ENUM ('BUY', 'SELL', 'SHORT', 'COVER', 'HOLD', 'ABSTAIN');

-- CreateEnum
CREATE TYPE "DecisionStatus" AS ENUM ('OPEN', 'SUCCESS', 'LOSS', 'EXPIRED', 'CANCELLED', 'NO_GO', 'TRADE_ABSTENTION');

-- CreateEnum
CREATE TYPE "BatchStatus" AS ENUM ('OPEN', 'SEALED', 'ANCHORED', 'FAILED');

-- CreateEnum
CREATE TYPE "AnchorStatus" AS ENUM ('PENDING', 'CONFIRMED', 'FAILED', 'LOCAL_ONLY');

-- CreateEnum
CREATE TYPE "Tier" AS ENUM ('UNVERIFIED', 'VERIFIED', 'BRONZE', 'SILVER', 'GOLD', 'ELITE');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('AGENT_CREATED', 'STRATEGY_REGISTERED', 'VERSION_CREATED', 'DECISION_COMMITTED', 'TRADE_EXECUTED', 'OUTCOME_REVEALED', 'PROOF_BATCHED', 'MERKLE_ROOT_CREATED', 'ANCHOR_CONFIRMED', 'REPUTATION_UPDATED', 'CORRECTION_RECORDED', 'VERIFICATION_REQUESTED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY['decisions:write', 'outcomes:write']::TEXT[],
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agents" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "venues" TEXT[],
    "assets" TEXT[],
    "chain" TEXT NOT NULL DEFAULT 'solana',
    "riskProfile" "RiskProfile" NOT NULL DEFAULT 'MODERATE',
    "status" "AgentStatus" NOT NULL DEFAULT 'ACTIVE',
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "strategies" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "strategies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "strategy_versions" (
    "id" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "configHash" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "creatorSignature" TEXT,
    "status" "VersionStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "strategy_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decisions" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "strategyVersionId" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "action" "DecisionAction" NOT NULL,
    "price" DECIMAL(38,12) NOT NULL,
    "quantity" DECIMAL(38,12) NOT NULL,
    "confidence" DECIMAL(5,4) NOT NULL,
    "nonce" TEXT NOT NULL,
    "commitmentHash" TEXT NOT NULL,
    "metadata" JSONB,
    "status" "DecisionStatus" NOT NULL DEFAULT 'OPEN',
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "decidedAt" TIMESTAMP(3) NOT NULL,
    "committedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outcomes" (
    "id" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "entryPrice" DECIMAL(38,12) NOT NULL,
    "exitPrice" DECIMAL(38,12) NOT NULL,
    "quantity" DECIMAL(38,12) NOT NULL,
    "fees" DECIMAL(38,12) NOT NULL,
    "slippage" DECIMAL(38,12) NOT NULL,
    "grossPnl" DECIMAL(38,12) NOT NULL,
    "realizedPnl" DECIMAL(38,12) NOT NULL,
    "roi" DECIMAL(18,8) NOT NULL,
    "notional" DECIMAL(38,12) NOT NULL,
    "holdingPeriodMs" BIGINT NOT NULL,
    "outcomeHash" TEXT NOT NULL,
    "settledAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outcomes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "corrections" (
    "id" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "detail" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "corrections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merkle_batches" (
    "id" TEXT NOT NULL,
    "sequence" SERIAL NOT NULL,
    "merkleRoot" TEXT NOT NULL,
    "leafCount" INTEGER NOT NULL,
    "status" "BatchStatus" NOT NULL DEFAULT 'OPEN',
    "sealedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "merkle_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proofs" (
    "id" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "leafHash" TEXT NOT NULL,
    "leafIndex" INTEGER NOT NULL,
    "path" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proofs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blockchain_anchors" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "merkleRoot" TEXT NOT NULL,
    "transactionHash" TEXT,
    "blockNumber" BIGINT,
    "explorerUrl" TEXT,
    "status" "AnchorStatus" NOT NULL DEFAULT 'PENDING',
    "anchoredAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blockchain_anchors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reputation_scores" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "score" DECIMAL(5,2) NOT NULL,
    "rawScore" DECIMAL(5,2) NOT NULL,
    "confidence" DECIMAL(6,4) NOT NULL,
    "performance" DECIMAL(5,2) NOT NULL,
    "risk" DECIMAL(5,2) NOT NULL,
    "drawdown" DECIMAL(5,2) NOT NULL,
    "consistency" DECIMAL(5,2) NOT NULL,
    "execution" DECIMAL(5,2) NOT NULL,
    "integrity" DECIMAL(5,2) NOT NULL,
    "metrics" JSONB NOT NULL,
    "sampleSize" INTEGER NOT NULL,
    "operatingDays" INTEGER NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reputation_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qualifications" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "tier" "Tier" NOT NULL,
    "nextTier" "Tier",
    "unmet" JSONB NOT NULL,
    "achievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qualifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "protocol_events" (
    "id" TEXT NOT NULL,
    "type" "EventType" NOT NULL,
    "agentId" TEXT,
    "subjectId" TEXT,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "protocol_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_requests" (
    "id" TEXT NOT NULL,
    "queryType" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "valid" BOOLEAN NOT NULL,
    "checks" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "apiKeyId" TEXT,
    "actorLabel" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "subjectId" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_createdAt_idx" ON "users"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_prefix_key" ON "api_keys"("prefix");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_keyHash_key" ON "api_keys"("keyHash");

-- CreateIndex
CREATE INDEX "api_keys_userId_idx" ON "api_keys"("userId");

-- CreateIndex
CREATE INDEX "api_keys_keyHash_idx" ON "api_keys"("keyHash");

-- CreateIndex
CREATE INDEX "api_keys_revokedAt_idx" ON "api_keys"("revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "agents_slug_key" ON "agents"("slug");

-- CreateIndex
CREATE INDEX "agents_ownerId_idx" ON "agents"("ownerId");

-- CreateIndex
CREATE INDEX "agents_status_idx" ON "agents"("status");

-- CreateIndex
CREATE INDEX "agents_verificationStatus_idx" ON "agents"("verificationStatus");

-- CreateIndex
CREATE INDEX "agents_createdAt_idx" ON "agents"("createdAt");

-- CreateIndex
CREATE INDEX "strategies_agentId_idx" ON "strategies"("agentId");

-- CreateIndex
CREATE UNIQUE INDEX "strategies_agentId_name_key" ON "strategies"("agentId", "name");

-- CreateIndex
CREATE INDEX "strategy_versions_strategyId_idx" ON "strategy_versions"("strategyId");

-- CreateIndex
CREATE INDEX "strategy_versions_configHash_idx" ON "strategy_versions"("configHash");

-- CreateIndex
CREATE INDEX "strategy_versions_status_idx" ON "strategy_versions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "strategy_versions_strategyId_version_key" ON "strategy_versions"("strategyId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "decisions_commitmentHash_key" ON "decisions"("commitmentHash");

-- CreateIndex
CREATE INDEX "decisions_agentId_idx" ON "decisions"("agentId");

-- CreateIndex
CREATE INDEX "decisions_strategyVersionId_idx" ON "decisions"("strategyVersionId");

-- CreateIndex
CREATE INDEX "decisions_status_idx" ON "decisions"("status");

-- CreateIndex
CREATE INDEX "decisions_decidedAt_idx" ON "decisions"("decidedAt");

-- CreateIndex
CREATE INDEX "decisions_committedAt_idx" ON "decisions"("committedAt");

-- CreateIndex
CREATE INDEX "decisions_commitmentHash_idx" ON "decisions"("commitmentHash");

-- CreateIndex
CREATE INDEX "decisions_agentId_status_idx" ON "decisions"("agentId", "status");

-- CreateIndex
CREATE INDEX "decisions_agentId_decidedAt_idx" ON "decisions"("agentId", "decidedAt");

-- CreateIndex
CREATE UNIQUE INDEX "outcomes_decisionId_key" ON "outcomes"("decisionId");

-- CreateIndex
CREATE UNIQUE INDEX "outcomes_outcomeHash_key" ON "outcomes"("outcomeHash");

-- CreateIndex
CREATE INDEX "outcomes_settledAt_idx" ON "outcomes"("settledAt");

-- CreateIndex
CREATE INDEX "outcomes_outcomeHash_idx" ON "outcomes"("outcomeHash");

-- CreateIndex
CREATE INDEX "corrections_decisionId_idx" ON "corrections"("decisionId");

-- CreateIndex
CREATE UNIQUE INDEX "merkle_batches_sequence_key" ON "merkle_batches"("sequence");

-- CreateIndex
CREATE UNIQUE INDEX "merkle_batches_merkleRoot_key" ON "merkle_batches"("merkleRoot");

-- CreateIndex
CREATE INDEX "merkle_batches_status_idx" ON "merkle_batches"("status");

-- CreateIndex
CREATE INDEX "merkle_batches_merkleRoot_idx" ON "merkle_batches"("merkleRoot");

-- CreateIndex
CREATE INDEX "merkle_batches_createdAt_idx" ON "merkle_batches"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "proofs_decisionId_key" ON "proofs"("decisionId");

-- CreateIndex
CREATE INDEX "proofs_batchId_idx" ON "proofs"("batchId");

-- CreateIndex
CREATE INDEX "proofs_leafHash_idx" ON "proofs"("leafHash");

-- CreateIndex
CREATE UNIQUE INDEX "proofs_batchId_leafIndex_key" ON "proofs"("batchId", "leafIndex");

-- CreateIndex
CREATE UNIQUE INDEX "blockchain_anchors_batchId_key" ON "blockchain_anchors"("batchId");

-- CreateIndex
CREATE INDEX "blockchain_anchors_transactionHash_idx" ON "blockchain_anchors"("transactionHash");

-- CreateIndex
CREATE INDEX "blockchain_anchors_merkleRoot_idx" ON "blockchain_anchors"("merkleRoot");

-- CreateIndex
CREATE INDEX "blockchain_anchors_status_idx" ON "blockchain_anchors"("status");

-- CreateIndex
CREATE INDEX "blockchain_anchors_network_idx" ON "blockchain_anchors"("network");

-- CreateIndex
CREATE INDEX "reputation_scores_agentId_idx" ON "reputation_scores"("agentId");

-- CreateIndex
CREATE INDEX "reputation_scores_computedAt_idx" ON "reputation_scores"("computedAt");

-- CreateIndex
CREATE INDEX "reputation_scores_agentId_computedAt_idx" ON "reputation_scores"("agentId", "computedAt");

-- CreateIndex
CREATE INDEX "qualifications_agentId_idx" ON "qualifications"("agentId");

-- CreateIndex
CREATE INDEX "qualifications_tier_idx" ON "qualifications"("tier");

-- CreateIndex
CREATE INDEX "qualifications_agentId_achievedAt_idx" ON "qualifications"("agentId", "achievedAt");

-- CreateIndex
CREATE INDEX "protocol_events_type_idx" ON "protocol_events"("type");

-- CreateIndex
CREATE INDEX "protocol_events_agentId_idx" ON "protocol_events"("agentId");

-- CreateIndex
CREATE INDEX "protocol_events_subjectId_idx" ON "protocol_events"("subjectId");

-- CreateIndex
CREATE INDEX "protocol_events_createdAt_idx" ON "protocol_events"("createdAt");

-- CreateIndex
CREATE INDEX "verification_requests_queryType_idx" ON "verification_requests"("queryType");

-- CreateIndex
CREATE INDEX "verification_requests_query_idx" ON "verification_requests"("query");

-- CreateIndex
CREATE INDEX "verification_requests_createdAt_idx" ON "verification_requests"("createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_apiKeyId_idx" ON "audit_logs"("apiKeyId");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agents" ADD CONSTRAINT "agents_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strategies" ADD CONSTRAINT "strategies_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strategy_versions" ADD CONSTRAINT "strategy_versions_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "strategies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_strategyVersionId_fkey" FOREIGN KEY ("strategyVersionId") REFERENCES "strategy_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outcomes" ADD CONSTRAINT "outcomes_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "decisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "corrections" ADD CONSTRAINT "corrections_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "decisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proofs" ADD CONSTRAINT "proofs_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "decisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proofs" ADD CONSTRAINT "proofs_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "merkle_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blockchain_anchors" ADD CONSTRAINT "blockchain_anchors_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "merkle_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reputation_scores" ADD CONSTRAINT "reputation_scores_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qualifications" ADD CONSTRAINT "qualifications_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "protocol_events" ADD CONSTRAINT "protocol_events_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
