/**
 * Wallet sign-in.
 *
 * The operator console holds an EVM keypair, not a password. Proving control of
 * that keypair is the whole of authentication here: the server issues a
 * one-time nonce, the wallet signs a human-readable message containing it, and
 * a valid signature over that exact message is what mints an API key.
 *
 * Signatures are EIP-191 personal_sign — the same thing MetaMask, Rabby and
 * WalletConnect produce — so any EVM wallet can authenticate without a
 * MERIT-specific signing scheme.
 *
 * Two properties this file exists to guarantee:
 *
 *  1. The signed text says plainly what it authorises. A wallet prompt that
 *     shows opaque bytes trains people to approve anything.
 *  2. A captured signature is worthless. The nonce is single-use and short
 *     lived, and the message is bound to the address that signed it.
 */

import { getAddress, verifyMessage } from "ethers";
import { randomBytes } from "node:crypto";
import { ProtocolError } from "../services/decisions";

export const CHALLENGE_TTL_MS = 5 * 60_000;

/**
 * Normalise to a checksummed 0x address, or reject.
 *
 * Storing the checksummed form keeps the unique index meaningful: the same
 * account typed in lower case and in mixed case must not become two rows.
 */
export function parseAddress(value: string): string {
  try {
    return getAddress(value.trim());
  } catch {
    throw new ProtocolError(
      "That is not a valid EVM address.",
      "INVALID_ADDRESS",
      400,
    );
  }
}

export function createNonce(): string {
  return randomBytes(24).toString("base64url");
}

/**
 * The exact text the wallet signs. Rebuilt byte-for-byte at verification time
 * from the stored challenge, so there is nothing to trust in what the client
 * sends back except the signature itself.
 */
export function challengeMessage(input: {
  address: string;
  nonce: string;
  issuedAt: Date;
}): string {
  return [
    "MERIT Protocol — sign in",
    "",
    `Address: ${input.address}`,
    `Nonce:   ${input.nonce}`,
    `Issued:  ${input.issuedAt.toISOString()}`,
    "",
    "Signing proves you control this wallet.",
    "It authorises no transaction and moves no funds.",
  ].join("\n");
}

/** Verify an EIP-191 signature and confirm it recovers to the claimed address. */
export function verifySignature(input: {
  address: string;
  message: string;
  signature: string;
}): boolean {
  try {
    // Recovery returns whoever actually signed; comparing that to the claimed
    // address is what makes a forged signature useless.
    return verifyMessage(input.message, input.signature) === getAddress(input.address);
  } catch {
    return false;
  }
}
