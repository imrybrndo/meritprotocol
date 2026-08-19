/**
 * EvmAnchorAdapter — the chain integration.
 *
 * A Merkle root is written as the calldata of a zero-value transaction the
 * anchoring wallet sends to itself. That is the EVM equivalent of the SPL Memo
 * this protocol used before: the cheapest durable way to bind arbitrary bytes
 * to a block, with no contract to deploy, no ABI to agree on, and no upgrade
 * path anyone has to trust. The payload is `merit:v1:0x…` in UTF-8, readable
 * from any RPC endpoint with nothing but the transaction hash.
 *
 * Deliberately not a registry contract. A contract would give nicer indexing
 * and cost a deployment, an owner, and a story about what happens when the
 * owner key is lost — three trust assumptions for a feature the protocol does
 * not need, since every root is already re-derivable from the proof bundle.
 *
 * Verification re-reads the transaction from the chain and compares the decoded
 * payload against the expected root. It never trusts the database copy, and it
 * checks the receipt status too: a reverted transaction has a hash and a block
 * and anchors nothing.
 */

import { JsonRpcProvider, Wallet, hexlify, toUtf8Bytes, toUtf8String } from "ethers";
import type { Hash } from "../crypto/hash";
import {
  decodeAnchorPayload,
  encodeAnchorPayload,
  type AnchorAdapter,
  type AnchorReceipt,
  type AnchorVerification,
} from "./types";

export interface EvmAnchorConfig {
  /** Short chain label used in the `network` string, e.g. "robinhood". */
  chainName: string;
  /**
   * Expected EIP-155 chain id. When set, it is checked against what the RPC
   * actually reports before the first write — see `assertChain`.
   */
  chainId: number | null;
  rpcUrl: string;
  /** Signs the anchor transaction. Holds no user funds. */
  wallet: Wallet;
  /** Base explorer URL, e.g. "https://explorer.example.com". Optional. */
  explorerBaseUrl: string | null;
  /** Blocks to wait for before reporting CONFIRMED. */
  confirmations: number;
}

/**
 * Turn a private key into a wallet.
 *
 * Accepts the `0x`-prefixed form and the bare one, because both are what
 * key-management tools hand you and rejecting one of them is a pointless
 * afternoon.
 */
export function walletFromSecret(secret: string): Wallet {
  const trimmed = secret.trim();
  return new Wallet(trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`);
}

export class EvmAnchorAdapter implements AnchorAdapter {
  readonly network: string;
  readonly isOnChain = true;

  private readonly provider: JsonRpcProvider;
  private readonly signer: Wallet;
  private chainChecked = false;

  constructor(private readonly config: EvmAnchorConfig) {
    this.network = `${config.chainName}:${config.chainId ?? "unknown"}`;
    this.provider = new JsonRpcProvider(config.rpcUrl, config.chainId ?? undefined);
    this.signer = config.wallet.connect(this.provider);
  }

  /** The address that signs anchors. Useful for funding checks and logs. */
  get address(): string {
    return this.signer.address;
  }

  private explorerUrl(transactionHash: string): string | null {
    if (!this.config.explorerBaseUrl) return null;
    return `${this.config.explorerBaseUrl.replace(/\/+$/, "")}/tx/${transactionHash}`;
  }

  /**
   * Refuse to write to a chain other than the configured one.
   *
   * An RPC URL pointing somewhere unexpected produces anchors that confirm,
   * cost money, and prove nothing about the chain the protocol claims to be on.
   * That failure is silent unless something checks, so this checks once per
   * process before the first write.
   */
  private async assertChain(): Promise<void> {
    if (this.chainChecked || this.config.chainId === null) return;

    const observed = await this.provider.getNetwork();
    if (Number(observed.chainId) !== this.config.chainId) {
      throw new Error(
        `RPC at ${this.config.rpcUrl} reports chain id ${observed.chainId}, ` +
          `but EVM_CHAIN_ID is ${this.config.chainId}. Refusing to anchor to an ` +
          "unexpected chain.",
      );
    }
    this.chainChecked = true;
  }

  async anchor(root: Hash): Promise<AnchorReceipt> {
    try {
      await this.assertChain();

      const submitted = await this.signer.sendTransaction({
        // To itself: the transaction exists to carry calldata, not to move value.
        to: this.signer.address,
        value: 0,
        data: hexlify(toUtf8Bytes(encodeAnchorPayload(root))),
      });

      const receipt = await submitted.wait(this.config.confirmations);

      if (!receipt || receipt.status !== 1) {
        // Mined but reverted. It has a hash, and it anchors nothing — reporting
        // it as CONFIRMED would be the single most misleading thing this
        // adapter could do.
        console.error(`[anchor] EVM transaction ${submitted.hash} reverted`);
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

      const block = await this.provider.getBlock(receipt.blockNumber);

      return {
        network: this.network,
        root,
        transactionHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        status: "CONFIRMED",
        anchoredAt: block?.timestamp ? new Date(block.timestamp * 1000) : new Date(),
        explorerUrl: this.explorerUrl(receipt.hash),
      };
    } catch (error) {
      // A failed submission is reported as FAILED with no transaction hash,
      // never as a confirmed anchor.
      console.error("[anchor] EVM submission failed", error);
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
    const transaction = await this.provider.getTransaction(transactionHash);
    if (!transaction) return null;

    const root = decodeCalldata(transaction.data);
    if (!root) return null;

    const block =
      transaction.blockNumber === null
        ? null
        : await this.provider.getBlock(transaction.blockNumber);

    return {
      network: this.network,
      root,
      transactionHash,
      blockNumber: transaction.blockNumber,
      status: "CONFIRMED",
      anchoredAt: block?.timestamp ? new Date(block.timestamp * 1000) : new Date(),
      explorerUrl: this.explorerUrl(transactionHash),
    };
  }

  async verifyAnchor(root: Hash, transactionHash: string): Promise<AnchorVerification> {
    const base = { network: this.network, transactionHash };

    let transaction;
    let receipt;
    try {
      [transaction, receipt] = await Promise.all([
        this.provider.getTransaction(transactionHash),
        this.provider.getTransactionReceipt(transactionHash),
      ]);
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

    if (!transaction) {
      return {
        ...base,
        valid: false,
        status: "PENDING",
        observedRoot: null,
        blockNumber: null,
        anchoredAt: null,
        reason: "Transaction not found on this chain.",
      };
    }

    if (transaction.blockNumber === null || !receipt) {
      return {
        ...base,
        valid: false,
        status: "PENDING",
        observedRoot: null,
        blockNumber: null,
        anchoredAt: null,
        reason: "Transaction is known to the node but not yet mined.",
      };
    }

    if (receipt.status !== 1) {
      return {
        ...base,
        valid: false,
        status: "FAILED",
        observedRoot: null,
        blockNumber: transaction.blockNumber,
        anchoredAt: null,
        reason: "Transaction was mined but reverted, so it anchors nothing.",
      };
    }

    const observedRoot = decodeCalldata(transaction.data);
    const block = await this.provider.getBlock(transaction.blockNumber);

    return {
      ...base,
      valid: observedRoot === root,
      status: "CONFIRMED",
      observedRoot,
      blockNumber: transaction.blockNumber,
      anchoredAt: block?.timestamp ? new Date(block.timestamp * 1000) : null,
      reason:
        observedRoot === root
          ? null
          : observedRoot
            ? "On-chain calldata commits to a different Merkle root."
            : "No MERIT anchor payload found in this transaction's calldata.",
    };
  }
}

/**
 * Read the anchor payload out of a transaction's calldata.
 *
 * Exported for the verification path and for tests: this is the step that turns
 * an opaque hex blob back into a claim about a Merkle root, and getting it
 * wrong in either direction — accepting a forgery or rejecting an honest
 * anchor — is the failure that matters most in this file.
 */
export function decodeCalldata(data: string): Hash | null {
  if (!data || data === "0x") return null;

  try {
    return decodeAnchorPayload(toUtf8String(data));
  } catch {
    // Calldata that is not valid UTF-8 is simply not one of ours. An ordinary
    // contract call reaching this path is expected, not exceptional.
    return null;
  }
}
