/**
 * SolanaAnchorAdapter — the first real chain integration.
 *
 * A Merkle root is written as an SPL Memo instruction. The memo program is the
 * cheapest durable way to bind arbitrary bytes to a slot, and the payload is
 * readable by anyone with the signature and a public RPC endpoint — no MERIT
 * infrastructure required to verify it.
 *
 * Verification re-reads the transaction from the chain and compares the memo
 * against the expected root. It never trusts the database copy.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import type { Hash } from "../crypto/hash";
import {
  decodeAnchorPayload,
  encodeAnchorPayload,
  type AnchorAdapter,
  type AnchorReceipt,
  type AnchorVerification,
} from "./types";

/** SPL Memo program, identical across Solana clusters. */
const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

export type SolanaCluster = "devnet" | "testnet" | "mainnet-beta";

export interface SolanaAnchorConfig {
  cluster: SolanaCluster;
  rpcUrl: string;
  /** Fee payer. Signs the memo transaction; holds no user funds. */
  payer: Keypair;
}

function explorerUrl(signature: string, cluster: SolanaCluster): string {
  const suffix = cluster === "mainnet-beta" ? "" : `?cluster=${cluster}`;
  return `https://explorer.solana.com/tx/${signature}${suffix}`;
}

/** Parse a keypair from a JSON byte array or a base64-encoded secret key. */
export function keypairFromSecret(secret: string): Keypair {
  const trimmed = secret.trim();

  if (trimmed.startsWith("[")) {
    const bytes = Uint8Array.from(JSON.parse(trimmed) as number[]);
    return Keypair.fromSecretKey(bytes);
  }

  return Keypair.fromSecretKey(Uint8Array.from(Buffer.from(trimmed, "base64")));
}

export class SolanaAnchorAdapter implements AnchorAdapter {
  readonly network: string;
  readonly isOnChain = true;

  private readonly connection: Connection;

  constructor(private readonly config: SolanaAnchorConfig) {
    this.network = `solana:${config.cluster}`;
    this.connection = new Connection(config.rpcUrl, "confirmed");
  }

  async anchor(root: Hash): Promise<AnchorReceipt> {
    const instruction = new TransactionInstruction({
      keys: [
        { pubkey: this.config.payer.publicKey, isSigner: true, isWritable: false },
      ],
      programId: MEMO_PROGRAM_ID,
      data: Buffer.from(encodeAnchorPayload(root), "utf8"),
    });

    try {
      const signature = await sendAndConfirmTransaction(
        this.connection,
        new Transaction().add(instruction),
        [this.config.payer],
        { commitment: "confirmed" },
      );

      const parsed = await this.connection.getTransaction(signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });

      return {
        network: this.network,
        root,
        transactionHash: signature,
        blockNumber: parsed?.slot ?? null,
        status: "CONFIRMED",
        anchoredAt: parsed?.blockTime ? new Date(parsed.blockTime * 1000) : new Date(),
        explorerUrl: explorerUrl(signature, this.config.cluster),
      };
    } catch (error) {
      // A failed submission is reported as FAILED with no transaction hash,
      // never as a confirmed anchor.
      console.error("[anchor] Solana submission failed", error);
      return {
        network: this.network,
        root,
        transactionHash: null,
        blockNumber: null,
        status: "FAILED",
        anchoredAt: new Date(),
        explorerUrl: null,
      };
    }
  }

  async getAnchor(transactionHash: string): Promise<AnchorReceipt | null> {
    const parsed = await this.connection.getTransaction(transactionHash, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (!parsed) return null;

    const root = this.extractRoot(parsed);
    if (!root) return null;

    return {
      network: this.network,
      root,
      transactionHash,
      blockNumber: parsed.slot,
      status: "CONFIRMED",
      anchoredAt: parsed.blockTime ? new Date(parsed.blockTime * 1000) : new Date(),
      explorerUrl: explorerUrl(transactionHash, this.config.cluster),
    };
  }

  async verifyAnchor(root: Hash, transactionHash: string): Promise<AnchorVerification> {
    const base = {
      network: this.network,
      transactionHash,
    };

    let parsed;
    try {
      parsed = await this.connection.getTransaction(transactionHash, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
    } catch (error) {
      return {
        ...base,
        valid: false,
        status: "PENDING",
        observedRoot: null,
        blockNumber: null,
        anchoredAt: null,
        reason: `RPC lookup failed: ${(error as Error).message}`,
      };
    }

    if (!parsed) {
      return {
        ...base,
        valid: false,
        status: "PENDING",
        observedRoot: null,
        blockNumber: null,
        anchoredAt: null,
        reason: "Transaction not found on this cluster.",
      };
    }

    if (parsed.meta?.err) {
      return {
        ...base,
        valid: false,
        status: "FAILED",
        observedRoot: null,
        blockNumber: parsed.slot,
        anchoredAt: parsed.blockTime ? new Date(parsed.blockTime * 1000) : null,
        reason: "Transaction executed with an error.",
      };
    }

    const observedRoot = this.extractRoot(parsed);

    return {
      ...base,
      valid: observedRoot === root,
      status: "CONFIRMED",
      observedRoot,
      blockNumber: parsed.slot,
      anchoredAt: parsed.blockTime ? new Date(parsed.blockTime * 1000) : null,
      reason:
        observedRoot === root
          ? null
          : observedRoot
            ? "On-chain memo commits to a different Merkle root."
            : "No MERIT anchor memo found in this transaction.",
    };
  }

  /** Pull the memo payload out of a confirmed transaction's log messages. */
  private extractRoot(parsed: {
    meta?: { logMessages?: string[] | null } | null;
  }): Hash | null {
    for (const line of parsed.meta?.logMessages ?? []) {
      // The memo program logs: Program log: Memo (len N): "merit:v1:0x…"
      const match = /Memo \(len \d+\): "(.*)"/.exec(line);
      if (!match) continue;

      const root = decodeAnchorPayload(match[1]);
      if (root) return root;
    }
    return null;
  }
}
