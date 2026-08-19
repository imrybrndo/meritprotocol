/**
 * Re-anchor batches that carry no on-chain record.
 *
 * The seed runs against whatever adapter is configured at the time. Batches
 * sealed while EVM_ANCHOR_PRIVATE_KEY was unset are LOCAL_ONLY: their Merkle
 * roots are real, but nothing binds them to a block. This script hands those
 * roots to the configured chain adapter and rewrites the anchor row with the
 * receipt it gets back.
 *
 * It is safe to re-run. Batches already CONFIRMED are skipped, and a batch that
 * fails submission keeps its previous row rather than gaining a fabricated one.
 *
 *   npm run anchor:pending
 */

import "dotenv/config";
import { JsonRpcProvider, formatEther } from "ethers";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client";
import { getAnchorService, walletFromSecret } from "../lib/anchor";
import { emitEvent } from "../lib/events";
import type { Hash } from "../lib/crypto/hash";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

/** Public RPCs throttle aggressively; pace submissions rather than retrying. */
const SUBMIT_DELAY_MS = 1_500;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Refuse to submit from an unfunded wallet.
 *
 * Without this the adapter would report FAILED for every batch, and the loop
 * below would overwrite good LOCAL_ONLY rows with that failure. Losing the
 * honest "sealed but not on chain" record to a funding problem is worse than
 * not running at all.
 */
async function assertFunded(batchCount: number): Promise<void> {
  const secret = process.env.EVM_ANCHOR_PRIVATE_KEY?.trim();
  const rpcUrl = process.env.EVM_RPC_URL?.trim();
  if (!secret || !rpcUrl) return;

  const wallet = walletFromSecret(secret);
  const provider = new JsonRpcProvider(rpcUrl);

  // Estimating the real cost means asking the chain, not assuming a constant:
  // gas prices differ per network and move within one. An anchor is a plain
  // calldata-carrying transfer, so 21000 plus 16 gas per non-zero byte is a
  // close enough upper bound for a funding check.
  const [balance, feeData] = await Promise.all([
    provider.getBalance(wallet.address),
    provider.getFeeData(),
  ]);

  const gasPrice = feeData.maxFeePerGas ?? feeData.gasPrice;
  if (gasPrice === null) {
    console.log(`Anchor wallet ${wallet.address} — could not read a gas price; skipping the funding check.\n`);
    return;
  }

  // 21000 base + 16 gas per non-zero calldata byte; the payload is ~80 bytes.
  // Written with BigInt() rather than a literal because the TS target is ES2017.
  const GAS_PER_ANCHOR = BigInt(21_000 + 16 * 80);
  const required = gasPrice * GAS_PER_ANCHOR * BigInt(batchCount);

  if (balance >= required) {
    console.log(`Anchor wallet ${wallet.address} — ${formatEther(balance)} (need ~${formatEther(required)})\n`);
    return;
  }

  console.error(
    `Anchor wallet ${wallet.address} holds ${formatEther(balance)}, ` +
      `needs at least ${formatEther(required)} for ${batchCount} anchor(s).\n` +
      `Fund it, then re-run.\n\n` +
      `No batch was modified.`,
  );
  process.exit(1);
}

async function main() {
  const anchorService = getAnchorService();

  if (!anchorService.isOnChain) {
    console.error(
      "Anchor adapter is not on-chain (network: " +
        anchorService.network +
        ").\nSet EVM_ANCHOR_PRIVATE_KEY and EVM_RPC_URL in .env, then re-run.",
    );
    process.exit(1);
  }

  const batches = await prisma.merkleBatch.findMany({
    where: { anchor: { is: { status: { in: ["LOCAL_ONLY", "FAILED", "PENDING"] } } } },
    include: { anchor: true },
    orderBy: { sequence: "asc" },
  });

  if (batches.length === 0) {
    console.log("Nothing to anchor — every batch already has a confirmed record.");
    return;
  }

  await assertFunded(batches.length);

  console.log(
    `Anchoring ${batches.length} batch(es) via ${anchorService.network}…\n`,
  );

  let confirmed = 0;
  let failed = 0;

  for (const batch of batches) {
    const root = batch.merkleRoot as Hash;
    const receipt = await anchorService.anchor(root);

    await prisma.$transaction(async (tx) => {
      await tx.blockchainAnchor.update({
        where: { batchId: batch.id },
        data: {
          network: receipt.network,
          merkleRoot: root,
          transactionHash: receipt.transactionHash,
          blockNumber: receipt.blockNumber === null ? null : BigInt(receipt.blockNumber),
          explorerUrl: receipt.explorerUrl,
          status: receipt.status,
          anchoredAt: receipt.anchoredAt,
          confirmedAt: receipt.status === "CONFIRMED" ? receipt.anchoredAt : null,
        },
      });

      await tx.merkleBatch.update({
        where: { id: batch.id },
        data: { status: receipt.status === "FAILED" ? "FAILED" : "ANCHORED" },
      });

      if (receipt.status === "CONFIRMED") {
        await emitEvent(tx, {
          type: "ANCHOR_CONFIRMED",
          subjectId: batch.id,
          payload: {
            merkleRoot: root,
            network: receipt.network,
            transactionHash: receipt.transactionHash,
          },
        });
      }
    });

    if (receipt.status === "CONFIRMED") {
      confirmed += 1;
      console.log(
        `  batch #${batch.sequence}: ${root.slice(0, 18)}… → slot ${receipt.blockNumber} [${receipt.transactionHash?.slice(0, 16)}…]`,
      );
    } else {
      failed += 1;
      console.log(`  batch #${batch.sequence}: ${root.slice(0, 18)}… → ${receipt.status}`);
    }

    await sleep(SUBMIT_DELAY_MS);
  }

  console.log(`\nDone: ${confirmed} confirmed, ${failed} failed.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
