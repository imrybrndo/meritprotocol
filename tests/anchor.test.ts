/**
 * The anchor layer.
 *
 * Two things are worth pinning here, and neither needs a chain.
 *
 * The first is the payload round trip. `decodeCalldata` is the step that turns
 * an opaque hex blob back into a claim about a Merkle root, and it is the only
 * thing standing between a verified anchor and a forged one. Both directions
 * matter: accepting calldata that does not commit to the root would validate a
 * forgery, and rejecting calldata that does would fail an honest anchor.
 *
 * The second is the fallback. An unconfigured or half-configured deployment
 * must land on the local adapter, which never invents a transaction hash — the
 * one guarantee that keeps "sealed" from being read as "anchored".
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { hexlify, toUtf8Bytes } from "ethers";
import {
  LocalAnchorAdapter,
  decodeCalldata,
  getAnchorService,
  setAnchorService,
  walletFromSecret,
} from "@/lib/anchor";
import { encodeAnchorPayload, decodeAnchorPayload } from "@/lib/anchor/types";
import type { Hash } from "@/lib/crypto/hash";

const ROOT = "0x91ab3f7c2d5e8a1b4c6d9e0f2a3b5c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b" as Hash;
const OTHER = "0x0000000000000000000000000000000000000000000000000000000000000001" as Hash;

/** Hardhat's published account #0. A well-known test key, never a secret. */
const TEST_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

const asCalldata = (text: string) => hexlify(toUtf8Bytes(text));

describe("anchor payload", () => {
  it("round-trips a root through calldata", () => {
    expect(decodeCalldata(asCalldata(encodeAnchorPayload(ROOT)))).toBe(ROOT);
  });

  it("returns the root it was given, not a different one", () => {
    expect(decodeCalldata(asCalldata(encodeAnchorPayload(OTHER)))).not.toBe(ROOT);
  });

  it("reads empty calldata as no anchor", () => {
    expect(decodeCalldata("0x")).toBeNull();
    expect(decodeCalldata("")).toBeNull();
  });

  /**
   * Most transactions on any chain are ordinary contract calls whose calldata is
   * an ABI-encoded selector. Reaching this path is expected traffic, not an
   * error, so it must return null rather than throw.
   */
  it("ignores calldata that is not valid UTF-8", () => {
    expect(decodeCalldata("0xa9059cbb00000000000000000000000000ff10")).toBeNull();
  });

  it("rejects a payload with the wrong prefix", () => {
    expect(decodeCalldata(asCalldata(`merit:v2:${ROOT}`))).toBeNull();
    expect(decodeCalldata(asCalldata(ROOT))).toBeNull();
    expect(decodeCalldata(asCalldata("hello world"))).toBeNull();
  });

  it("rejects a malformed digest inside a well-formed envelope", () => {
    expect(decodeCalldata(asCalldata("merit:v1:0xnothex"))).toBeNull();
    expect(decodeCalldata(asCalldata("merit:v1:0xabc"))).toBeNull();
    // Upper-case hex is not what the protocol writes, so it is not accepted.
    expect(decodeCalldata(asCalldata(`merit:v1:${ROOT.toUpperCase()}`))).toBeNull();
  });

  it("tolerates surrounding whitespace, which some explorers add", () => {
    expect(decodeAnchorPayload(`  merit:v1:${ROOT}\n`)).toBe(ROOT);
  });
});

describe("wallet parsing", () => {
  it("accepts a key with and without the 0x prefix", () => {
    const withPrefix = walletFromSecret(TEST_KEY);
    const without = walletFromSecret(TEST_KEY.slice(2));
    expect(withPrefix.address).toBe(without.address);
  });

  it("tolerates surrounding whitespace from a copied env value", () => {
    expect(walletFromSecret(`  ${TEST_KEY}  `).address).toBe(
      walletFromSecret(TEST_KEY).address,
    );
  });

  it("throws on a key that is not a key", () => {
    expect(() => walletFromSecret("not-a-key")).toThrow();
  });
});

describe("local adapter", () => {
  it("never produces a transaction hash", async () => {
    const receipt = await new LocalAnchorAdapter().anchor(ROOT);
    expect(receipt.transactionHash).toBeNull();
    expect(receipt.blockNumber).toBeNull();
    expect(receipt.status).toBe("LOCAL_ONLY");
    expect(receipt.explorerUrl).toBeNull();
  });

  /**
   * The guarantee the whole fallback rests on: a locally sealed root must never
   * verify, however internally consistent it is. "Sealed" and "anchored" are
   * different claims and only one of them is third-party checkable.
   */
  it("refuses to verify a root it sealed itself", async () => {
    const adapter = new LocalAnchorAdapter();
    await adapter.anchor(ROOT);

    const result = await adapter.verifyAnchor(ROOT);
    expect(result.valid).toBe(false);
    expect(result.status).toBe("LOCAL_ONLY");
    expect(result.reason).toMatch(/never written to a blockchain/i);
  });

  it("does not claim to be on-chain", () => {
    expect(new LocalAnchorAdapter().isOnChain).toBe(false);
  });
});

describe("adapter selection", () => {
  afterEach(() => {
    setAnchorService(null);
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("falls back to local with no signing key", () => {
    setAnchorService(null);
    vi.stubEnv("EVM_ANCHOR_PRIVATE_KEY", "");
    vi.stubEnv("EVM_RPC_URL", "");

    expect(getAnchorService().isOnChain).toBe(false);
  });

  /**
   * The half-configured case, which is the one that bites: a key is set, an RPC
   * URL is not, and the deployment looks configured. It must land on local and
   * say so, rather than appearing to anchor.
   */
  it("falls back to local, loudly, when a key has no RPC URL", () => {
    setAnchorService(null);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("EVM_ANCHOR_PRIVATE_KEY", TEST_KEY);
    vi.stubEnv("EVM_RPC_URL", "");

    expect(getAnchorService().isOnChain).toBe(false);
    expect(error).toHaveBeenCalled();
  });

  it("falls back to local, loudly, on an unreadable key", () => {
    setAnchorService(null);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("EVM_ANCHOR_PRIVATE_KEY", "clearly-not-a-private-key");
    vi.stubEnv("EVM_RPC_URL", "https://rpc.example.com");

    expect(getAnchorService().isOnChain).toBe(false);
    expect(error).toHaveBeenCalled();
  });

  it("builds the chain adapter when both are configured", () => {
    setAnchorService(null);
    vi.stubEnv("EVM_ANCHOR_PRIVATE_KEY", TEST_KEY);
    vi.stubEnv("EVM_RPC_URL", "https://rpc.example.com");
    vi.stubEnv("EVM_CHAIN_NAME", "robinhood");
    vi.stubEnv("EVM_CHAIN_ID", "42");

    const adapter = getAnchorService();
    expect(adapter.isOnChain).toBe(true);
    // No network call is made by the constructor, so this stays offline.
    expect(adapter.network).toBe("robinhood:42");
  });
});
