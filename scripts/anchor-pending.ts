/**
 * Re-anchor batches that carry no on-chain record.
 *
 * The seed runs against whatever adapter is configured at the time. Batches
 * sealed while SOLANA_ANCHOR_SECRET_KEY was unset are LOCAL_ONLY: their Merkle
 * roots are real, but nothing binds them to a slot. This script hands those
 * roots to the configured chain adapter and rewrites the anchor row with the
 * receipt it gets back.
 *
 * It is safe to re-run. Batches already CONFIRMED are skipped, and a batch that
 * fails submission keeps its previous row rather than gaining a fabricated one.
 *
 *   npm run anchor:pending
 */

import "dotenv/config";
import { Connection, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client";
import { getAnchorService, keypairFromSecret } from "../lib/anchor";
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

/** A memo transaction costs 5000 lamports; keep headroom for the whole run. */
const LAMPORTS_PER_ANCHOR = 5_000;

/**
 * Refuse to submit from an unfunded wallet.
 *
 * Without this the adapter would report FAILED for every batch, and the loop
 * below would overwrite good LOCAL_ONLY rows with that failure. Losing the
 * honest "sealed but not on chain" record to a funding problem is worse than
 * not running at all.
 */
async function assertFunded(required: number): Promise<void> {
  const secret = process.env.SOLANA_ANCHOR_SECRET_KEY?.trim();
  if (!secret) return;

  const rpcUrl = process.env.SOLANA_RPC_URL?.trim() || "https://api.devnet.solana.com";
  const payer = keypairFromSecret(secret);
  const balance = await new Connection(rpcUrl, "confirmed").getBalance(payer.publicKey);

  if (balance >= required) {
    console.log(
      `Fee payer ${payer.publicKey.toBase58()} — ${(balance / LAMPORTS_PER_SOL).toFixed(6)} SOL\n`,
    );
    return;
  }

  console.error(
    `Fee payer ${payer.publicKey.toBase58()} holds ${(balance / LAMPORTS_PER_SOL).toFixed(6)} SOL, ` +
      `needs at least ${(required / LAMPORTS_PER_SOL).toFixed(6)} SOL.\n` +
      `Fund it, then re-run:\n` +
      `  solana airdrop 1 ${payer.publicKey.toBase58()} --url devnet\n` +
      `  (or https://faucet.solana.com if the CLI faucet is rate-limited)\n\n` +
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
        ").\nSet SOLANA_ANCHOR_SECRET_KEY in .env, then re-run.",
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

  await assertFunded(batches.length * LAMPORTS_PER_ANCHOR);

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
