import type { NextRequest } from "next/server";
import { getPrisma } from "@/lib/db";
import { audit, generateApiKey } from "@/lib/api/auth";
import {
  clientIdentifier,
  created,
  parseBody,
  rateLimit,
  toErrorResponse,
  tooManyRequests,
} from "@/lib/api/http";
import { challengeMessage, parseAddress, verifySignature } from "@/lib/api/wallet-auth";
import { walletSignInSchema } from "@/lib/validation/schemas";
import { ProtocolError } from "@/lib/services/decisions";

export const runtime = "nodejs";

/**
 * Wallet accounts have no email, but the column is required and unique on User.
 * A synthetic address-derived local address keeps that invariant without a
 * second migration, and is unmistakably not a mailbox anyone should write to.
 */
function placeholderEmail(address: string): string {
  return `wallet+${address}@merit.invalid`;
}

/**
 * POST /api/v1/auth/wallet — exchange a signed challenge for an API key.
 *
 * The signature is the credential. A first sign-in creates the account; every
 * sign-in mints a fresh key, because the plaintext of the old one is
 * unrecoverable by design.
 *
 * The previous console key is revoked as the new one is issued. Without that,
 * an operator who unlocks the console twice a day accumulates a live credential
 * per unlock, and revoking them later means guessing which is in use. Keys
 * issued by any other means — the CLI, the dashboard — are never touched.
 */
const CONSOLE_KEY_PREFIX = "Console · ";

export async function POST(request: NextRequest) {
  try {
    const limit = rateLimit(`auth:wallet:${clientIdentifier(request)}`, 20);
    if (!limit.allowed) return tooManyRequests(limit);

    const body = await parseBody(request, walletSignInSchema);
    const address = parseAddress(body.address);
    const prisma = getPrisma();

    const challenge = await prisma.walletChallenge.findUnique({
      where: { nonce: body.nonce },
      select: { id: true, address: true, createdAt: true, expiresAt: true, usedAt: true },
    });

    // One error for every way a challenge can be unusable: telling a caller
    // which of these it hit only helps them probe.
    const unusable =
      !challenge ||
      challenge.address !== address ||
      challenge.usedAt !== null ||
      challenge.expiresAt.getTime() < Date.now();

    if (unusable) {
      throw new ProtocolError(
        "That sign-in challenge is expired or already used. Request a new one.",
        "CHALLENGE_INVALID",
        401,
      );
    }

    const valid = verifySignature({
      address,
      message: challengeMessage({ address, nonce: body.nonce, issuedAt: challenge.createdAt }),
      signature: body.signature,
    });
    if (!valid) {
      throw new ProtocolError("Signature does not match that address.", "SIGNATURE_INVALID", 401);
    }

    // Claim the challenge before minting anything. The conditional update is
    // the race guard: two requests carrying the same signature, only one wins.
    const claimed = await prisma.walletChallenge.updateMany({
      where: { id: challenge.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (claimed.count !== 1) {
      throw new ProtocolError(
        "That sign-in challenge is expired or already used. Request a new one.",
        "CHALLENGE_INVALID",
        401,
      );
    }

    const credential = generateApiKey("live");

    const { user, apiKey, retired } = await prisma.$transaction(async (tx) => {
      const account =
        (await tx.user.findUnique({ where: { walletAddress: address } })) ??
        (await tx.user.create({
          data: {
            walletAddress: address,
            email: placeholderEmail(address),
            name: `${address.slice(0, 4)}…${address.slice(-4)}`,
          },
        }));

      // Retire the previous console credential in the same transaction, so there
      // is never a moment with two live ones or none.
      const retired = await tx.apiKey.updateMany({
        where: {
          userId: account.id,
          revokedAt: null,
          name: { startsWith: CONSOLE_KEY_PREFIX },
        },
        data: { revokedAt: new Date() },
      });

      const key = await tx.apiKey.create({
        data: {
          userId: account.id,
          prefix: credential.prefix,
          keyHash: credential.keyHash,
          name: `${CONSOLE_KEY_PREFIX}${new Date().toISOString().slice(0, 10)}`,
        },
        select: { id: true, prefix: true, name: true, scopes: true },
      });

      return { user: account, apiKey: key, retired: retired.count };
    });

    await audit({
      key: { id: apiKey.id, userId: user.id, prefix: apiKey.prefix, scopes: apiKey.scopes, label: apiKey.name },
      action: "AUTH_WALLET_SIGN_IN",
      subjectId: user.id,
      request,
      metadata: { address, retiredKeys: retired },
    });

    return created({
      // Returned exactly once. The server keeps only the digest.
      apiKey: credential.key,
      account: {
        id: user.id,
        walletAddress: address,
        createdAt: user.createdAt.toISOString(),
      },
      session: { prefix: apiKey.prefix, label: apiKey.name, scopes: apiKey.scopes },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
