/**
 * Demo data.
 *
 * Everything here goes through the same commitment, batching and anchoring code
 * paths as a live agent, so every seeded proof genuinely verifies — the hashes
 * are real SHA-256 digests over real records, and the Merkle roots are real
 * roots over those digests.
 *
 * What is *not* real is the trading. Prices follow a seeded random walk. Every
 * agent, decision and outcome created here is flagged `isDemo`, and the UI
 * labels them so demo performance is never read as a live track record.
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client";
import { Prisma } from "../lib/generated/prisma/client";
import { commitDecision, commitOutcome, hashStrategyConfig } from "../lib/crypto/hash";
import { MerkleService } from "../lib/crypto/merkle";
import { getAnchorService } from "../lib/anchor";
import { randomBytes } from "node:crypto";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env first.");
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

/* ------------------------------------------------------------ determinism -- */

/** Mulberry32 — small, seeded PRNG so a reseed reproduces the same story. */
function rng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box-Muller, for return distributions that are not uniform. */
function gaussian(random: () => number): number {
  const u = Math.max(random(), 1e-9);
  const v = Math.max(random(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const DAY = 86_400_000;
const dec = (value: number) => new Prisma.Decimal(value.toFixed(12));

/* -------------------------------------------------------------- blueprints -- */

interface AgentBlueprint {
  slug: string;
  name: string;
  description: string;
  strategyName: string;
  strategyDescription: string;
  model: string;
  modelVersion: string;
  versions: string[];
  assets: string[];
  venues: string[];
  risk: "CONSERVATIVE" | "MODERATE" | "AGGRESSIVE";
  seed: number;
  decisions: number;
  /** Mean per-trade return. */
  edge: number;
  /** Per-trade return dispersion. */
  volatility: number;
  /** Share of decisions that are HOLD/ABSTAIN rather than trades. */
  abstainRate: number;
  /** Share of actionable decisions left OPEN or EXPIRED. */
  unsettledRate: number;
  basePrice: Record<string, number>;
  config: Record<string, unknown>;
}

const BLUEPRINTS: AgentBlueprint[] = [
  {
    slug: "ALPHA-001",
    name: "Alpha Momentum",
    description:
      "Trend-following agent trading perpetual futures on funding-rate and momentum confluence. Sizes into strength, exits on momentum decay.",
    strategyName: "Momentum + Funding Rate",
    strategyDescription:
      "Ranks assets by 4h momentum, filters by funding rate sign, enters on breakout confirmation.",
    model: "GPT-based Autonomous Trader",
    modelVersion: "2026-05",
    versions: ["1.0.0", "1.1.0", "2.0.0", "2.1.0"],
    assets: ["SOL", "BTC", "ETH"],
    venues: ["drift", "jupiter"],
    risk: "MODERATE",
    seed: 1_001,
    decisions: 1_284,
    edge: 0.0062,
    volatility: 0.031,
    abstainRate: 0.14,
    unsettledRate: 0.03,
    basePrice: { SOL: 182.4, BTC: 94_200, ETH: 3_240 },
    config: { lookbackHours: 4, breakoutSigma: 1.8, fundingFilter: true, maxLeverage: 3 },
  },
  {
    slug: "DELTA-002",
    name: "Delta Arbitrage",
    description:
      "Cross-venue basis agent. Captures spread between perpetual and spot markets, holding delta-neutral inventory.",
    strategyName: "Cross-Venue Basis",
    strategyDescription:
      "Monitors perp-spot basis across venues, enters when spread exceeds execution cost by a margin.",
    model: "Quantitative Ensemble",
    modelVersion: "4.2",
    versions: ["1.0.0", "1.2.0", "1.3.0"],
    assets: ["SOL", "ETH"],
    venues: ["drift", "zeta", "orca"],
    risk: "CONSERVATIVE",
    seed: 2_002,
    decisions: 946,
    edge: 0.0028,
    volatility: 0.0085,
    abstainRate: 0.22,
    unsettledRate: 0.02,
    basePrice: { SOL: 181.9, ETH: 3_235 },
    config: { minBasisBps: 18, maxInventoryUsd: 250_000, rebalanceMinutes: 30 },
  },
  {
    slug: "NOVA-003",
    name: "Nova Mean Reversion",
    description:
      "Counter-trend agent fading short-horizon dislocations in liquid majors. Tight stops, high turnover.",
    strategyName: "Statistical Mean Reversion",
    strategyDescription:
      "Fades 15m z-score extremes against a rolling volatility band, exits on reversion to the mean.",
    model: "Transformer Forecaster",
    modelVersion: "1.9",
    versions: ["1.0.0", "2.0.0"],
    assets: ["SOL", "BTC"],
    venues: ["drift"],
    risk: "AGGRESSIVE",
    seed: 3_003,
    decisions: 2_140,
    edge: 0.0021,
    volatility: 0.042,
    abstainRate: 0.08,
    unsettledRate: 0.05,
    basePrice: { SOL: 183.1, BTC: 93_800 },
    config: { zEntry: 2.1, zExit: 0.3, windowMinutes: 15, stopSigma: 3.4 },
  },
  {
    slug: "ATLAS-004",
    name: "Atlas Market Maker",
    description:
      "Two-sided quoting agent on a single venue. Earns spread and rebates, manages inventory skew continuously.",
    strategyName: "Inventory-Aware Quoting",
    strategyDescription:
      "Posts symmetric quotes around micro-price, skewing with inventory and widening with realised volatility.",
    model: "Hybrid Rules + LLM Supervisor",
    modelVersion: "3.0",
    versions: ["1.0.0", "1.1.0", "1.2.0", "1.3.0", "2.0.0"],
    assets: ["SOL"],
    venues: ["phoenix"],
    risk: "CONSERVATIVE",
    seed: 4_004,
    decisions: 3_610,
    edge: 0.0011,
    volatility: 0.0052,
    abstainRate: 0.05,
    unsettledRate: 0.01,
    basePrice: { SOL: 182.0 },
    config: { spreadBps: 7, inventoryLimit: 1_800, quoteRefreshMs: 900 },
  },
  {
    slug: "ORION-005",
    name: "Orion Funding",
    description:
      "Carry agent harvesting persistent funding-rate imbalances. Low turnover, long holding periods, exposed to regime shifts.",
    strategyName: "Funding Carry",
    strategyDescription:
      "Takes the side paid by funding when the rate exceeds a threshold and stays until it normalises.",
    model: "Bayesian Regime Model",
    modelVersion: "2.4",
    versions: ["1.0.0", "1.1.0"],
    assets: ["BTC", "ETH", "SOL"],
    venues: ["drift", "mango"],
    risk: "MODERATE",
    seed: 5_005,
    decisions: 412,
    edge: 0.0074,
    volatility: 0.048,
    abstainRate: 0.31,
    unsettledRate: 0.04,
    basePrice: { BTC: 94_000, ETH: 3_250, SOL: 182.7 },
    config: { fundingThresholdBps: 12, maxHoldHours: 72, regimePrior: 0.6 },
  },
];

/* -------------------------------------------------------------------- seed -- */

async function main() {
  console.log("Resetting demo data…");

  // Only demo records are cleared; anything an operator recorded is left alone.
  await prisma.$transaction([
    prisma.protocolEvent.deleteMany({ where: { agent: { isDemo: true } } }),
    prisma.agent.deleteMany({ where: { isDemo: true } }),
    prisma.user.deleteMany({ where: { email: "demo@merit.protocol" } }),
  ]);

  const owner = await prisma.user.create({
    data: { email: "demo@merit.protocol", name: "MERIT Demo" },
  });

  const anchorService = getAnchorService();
  console.log(
    `Anchor adapter: ${anchorService.network} (${anchorService.isOnChain ? "on-chain" : "local, no chain write"})`,
  );

  const allCommitments: { decisionId: string; commitmentHash: string }[] = [];

  for (const blueprint of BLUEPRINTS) {
    console.log(`\n${blueprint.slug} — ${blueprint.name}`);
    const random = rng(blueprint.seed);

    const agent = await prisma.agent.create({
      data: {
        slug: blueprint.slug,
        name: blueprint.name,
        description: blueprint.description,
        ownerId: owner.id,
        walletAddress: `Demo${randomBytes(20).toString("hex").slice(0, 40)}`,
        venues: blueprint.venues,
        assets: blueprint.assets,
        chain: "robinhood",
        riskProfile: blueprint.risk,
        status: "ACTIVE",
        verificationStatus: "VERIFIED",
        isDemo: true,
      },
    });

    await prisma.protocolEvent.create({
      data: {
        type: "AGENT_CREATED",
        agentId: agent.id,
        subjectId: agent.id,
        payload: { slug: agent.slug, demo: true },
      },
    });

    const strategy = await prisma.strategy.create({
      data: {
        agentId: agent.id,
        name: blueprint.strategyName,
        description: blueprint.strategyDescription,
      },
    });

    // Immutable version history. Older versions are SUPERSEDED, never edited.
    const versions = [];
    for (const [index, version] of blueprint.versions.entries()) {
      const isLatest = index === blueprint.versions.length - 1;
      const config = { ...blueprint.config, revision: index + 1 };

      versions.push(
        await prisma.strategyVersion.create({
          data: {
            strategyId: strategy.id,
            version,
            description: `${blueprint.strategyDescription} (revision ${index + 1})`,
            model: blueprint.model,
            modelVersion: `${blueprint.modelVersion}.${index}`,
            configHash: hashStrategyConfig(config),
            config,
            status: isLatest ? "ACTIVE" : "SUPERSEDED",
            createdAt: new Date(Date.now() - (blueprint.versions.length - index) * 60 * DAY),
          },
        }),
      );
    }

    const start = Date.now() - 400 * DAY;
    const span = 396 * DAY;
    const prices = { ...blueprint.basePrice };

    const decisionRows: Prisma.DecisionCreateManyInput[] = [];
    const outcomeSpecs: Array<{
      commitmentHash: string;
      decidedAt: Date;
      committedAt: Date;
      entry: number;
      exit: number;
      quantity: number;
      fees: number;
      slippage: number;
      direction: number;
      settledAt: Date;
    }> = [];

    for (let i = 0; i < blueprint.decisions; i += 1) {
      const decidedAt = new Date(start + (span * i) / blueprint.decisions);
      const committedAt = new Date(decidedAt.getTime() + 400 + random() * 900);

      const asset = blueprint.assets[Math.floor(random() * blueprint.assets.length)];
      // Random walk keeps demo prices plausible instead of flat.
      prices[asset] *= 1 + gaussian(random) * 0.012;
      const price = prices[asset];

      const roll = random();
      const isAbstention = roll < blueprint.abstainRate;
      const action = isAbstention
        ? roll < blueprint.abstainRate / 2
          ? "ABSTAIN"
          : "HOLD"
        : random() < 0.62
          ? "BUY"
          : "SHORT";

      // Roughly $5k notional per position, scaled by a random sizing factor.
      const quantity = isAbstention
        ? 0
        : Number(((5_000 / price) * (0.5 + random())).toFixed(6));
      const confidence = Number((0.5 + random() * 0.45).toFixed(4));
      const nonce = randomBytes(16).toString("hex");
      const versionIndex = Math.min(
        versions.length - 1,
        Math.floor((i / blueprint.decisions) * versions.length),
      );
      const version = versions[versionIndex];
      const metadata = { venue: blueprint.venues[0], demo: true };

      const commitmentHash = commitDecision({
        agentId: agent.id,
        strategyVersionId: version.id,
        strategyVersion: version.version,
        asset,
        action,
        price: price.toFixed(12),
        quantity: quantity.toFixed(12),
        confidence: confidence.toFixed(12),
        decidedAt,
        nonce,
        metadata,
      });

      const unsettled = !isAbstention && random() < blueprint.unsettledRate;

      let status: Prisma.DecisionCreateManyInput["status"];
      if (isAbstention) status = action === "ABSTAIN" ? "TRADE_ABSTENTION" : "NO_GO";
      else if (unsettled) status = random() < 0.5 ? "OPEN" : "EXPIRED";
      else status = "OPEN"; // settled below, then flipped to SUCCESS/LOSS

      decisionRows.push({
        agentId: agent.id,
        strategyVersionId: version.id,
        asset,
        action,
        price: dec(price),
        quantity: dec(quantity),
        confidence: dec(confidence),
        nonce,
        commitmentHash,
        metadata,
        status,
        isDemo: true,
        decidedAt,
        committedAt,
      });

      if (!isAbstention && !unsettled) {
        const direction = action === "SHORT" ? -1 : 1;
        const grossReturn = blueprint.edge + gaussian(random) * blueprint.volatility;
        const holdMs = (2 + random() * 46) * 3_600_000;
        const exit = price * (1 + grossReturn * direction);

        outcomeSpecs.push({
          commitmentHash,
          decidedAt,
          committedAt,
          entry: price,
          exit,
          quantity,
          fees: price * quantity * 0.0006,
          slippage: price * 0.0004 * random(),
          direction,
          settledAt: new Date(committedAt.getTime() + holdMs),
        });
      }
    }

    await prisma.decision.createMany({ data: decisionRows });
    console.log(`  ${decisionRows.length} decisions committed`);

    const stored = await prisma.decision.findMany({
      where: { agentId: agent.id },
      select: { id: true, commitmentHash: true },
    });
    const byCommitment = new Map(stored.map((d) => [d.commitmentHash, d.id]));
    for (const [hash, id] of byCommitment) allCommitments.push({ decisionId: id, commitmentHash: hash });

    // Outcomes, bound to the commitments sealed above.
    const outcomeRows: Prisma.OutcomeCreateManyInput[] = [];
    const successIds: string[] = [];
    const lossIds: string[] = [];

    for (const spec of outcomeSpecs) {
      const decisionId = byCommitment.get(spec.commitmentHash);
      if (!decisionId) continue;

      const grossPnl = (spec.exit - spec.entry) * spec.quantity * spec.direction;
      const realizedPnl = grossPnl - spec.fees - spec.slippage * spec.quantity;
      const notional = spec.entry * spec.quantity;

      const outcomeHash = commitOutcome({
        decisionId,
        commitmentHash: spec.commitmentHash,
        entryPrice: spec.entry.toFixed(12),
        exitPrice: spec.exit.toFixed(12),
        quantity: spec.quantity.toFixed(12),
        fees: spec.fees.toFixed(12),
        slippage: spec.slippage.toFixed(12),
        realizedPnl: realizedPnl.toFixed(12),
        settledAt: spec.settledAt,
      });

      outcomeRows.push({
        decisionId,
        entryPrice: dec(spec.entry),
        exitPrice: dec(spec.exit),
        quantity: dec(spec.quantity),
        fees: dec(spec.fees),
        slippage: dec(spec.slippage),
        grossPnl: dec(grossPnl),
        realizedPnl: dec(realizedPnl),
        roi: dec(notional === 0 ? 0 : realizedPnl / notional),
        notional: dec(notional),
        holdingPeriodMs: BigInt(
          Math.max(0, spec.settledAt.getTime() - spec.committedAt.getTime()),
        ),
        outcomeHash,
        settledAt: spec.settledAt,
      });

      (realizedPnl >= 0 ? successIds : lossIds).push(decisionId);
    }

    await prisma.outcome.createMany({ data: outcomeRows });
    await prisma.decision.updateMany({
      where: { id: { in: successIds } },
      data: { status: "SUCCESS" },
    });
    await prisma.decision.updateMany({
      where: { id: { in: lossIds } },
      data: { status: "LOSS" },
    });

    console.log(
      `  ${outcomeRows.length} outcomes revealed (${successIds.length} profitable, ${lossIds.length} losing)`,
    );
  }

  /* --------------------------------------------------- batching + anchoring */

  console.log("\nBatching commitments…");
  const BATCH_SIZE = 512;

  for (let offset = 0; offset < allCommitments.length; offset += BATCH_SIZE) {
    const slice = allCommitments.slice(offset, offset + BATCH_SIZE);
    const { tree, proofs } = MerkleService.createBatch(slice.map((c) => c.commitmentHash));

    const batch = await prisma.merkleBatch.create({
      data: {
        merkleRoot: tree.root,
        leafCount: slice.length,
        status: "SEALED",
        sealedAt: new Date(),
      },
    });

    await prisma.proof.createMany({
      data: proofs.map((proof, index) => ({
        decisionId: slice[index].decisionId,
        batchId: batch.id,
        leafHash: proof.leaf,
        leafIndex: proof.leafIndex,
        path: proof.path as unknown as Prisma.InputJsonValue,
      })),
    });

    const receipt = await anchorService.anchor(tree.root);

    await prisma.blockchainAnchor.create({
      data: {
        batchId: batch.id,
        network: receipt.network,
        merkleRoot: tree.root,
        transactionHash: receipt.transactionHash,
        blockNumber: receipt.blockNumber === null ? null : BigInt(receipt.blockNumber),
        explorerUrl: receipt.explorerUrl,
        status: receipt.status,
        anchoredAt: receipt.anchoredAt,
        confirmedAt: receipt.status === "CONFIRMED" ? receipt.anchoredAt : null,
      },
    });

    await prisma.merkleBatch.update({
      where: { id: batch.id },
      data: { status: receipt.status === "FAILED" ? "FAILED" : "ANCHORED" },
    });

    await prisma.protocolEvent.create({
      data: {
        type: "MERKLE_ROOT_CREATED",
        subjectId: batch.id,
        payload: { merkleRoot: tree.root, leafCount: slice.length, status: receipt.status },
      },
    });

    console.log(
      `  batch #${batch.sequence}: ${slice.length} leaves → ${tree.root.slice(0, 18)}… [${receipt.status}]`,
    );
  }

  const totals = {
    agents: await prisma.agent.count(),
    decisions: await prisma.decision.count(),
    outcomes: await prisma.outcome.count(),
    proofs: await prisma.proof.count(),
    batches: await prisma.merkleBatch.count(),
  };

  console.log("\nSeed complete:", totals);
  console.log(
    "All seeded records are flagged isDemo and are labelled DEMO throughout the UI.",
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
