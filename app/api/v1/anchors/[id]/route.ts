import type { NextRequest } from "next/server";
import { getPrisma } from "@/lib/db";
import { apiError, clientIdentifier, ok, rateLimit, toErrorResponse, tooManyRequests } from "@/lib/api/http";
import { getAnchorService } from "@/lib/anchor";
import type { Hash } from "@/lib/crypto/hash";

export const runtime = "nodejs";

/**
 * GET /api/v1/anchors/:id — anchor by id, transaction hash or Merkle root.
 *
 * The stored row is returned alongside a fresh re-read of the chain, so a
 * divergence between database and chain is visible rather than hidden.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const limit = rateLimit(`anchor:${clientIdentifier(request)}`, 60);
    if (!limit.allowed) return tooManyRequests(limit);

    const { id } = await params;
    const anchor = await getPrisma().blockchainAnchor.findFirst({
      where: { OR: [{ id }, { transactionHash: id }, { merkleRoot: id.toLowerCase() }] },
      include: { batch: { select: { sequence: true, leafCount: true } } },
    });

    if (!anchor) return apiError("ANCHOR_NOT_FOUND", "No anchor matches this identifier", 404);

    const service = getAnchorService();
    const onChain = anchor.transactionHash
      ? await service.verifyAnchor(anchor.merkleRoot as Hash, anchor.transactionHash)
      : null;

    return ok({
      id: anchor.id,
      network: anchor.network,
      merkleRoot: anchor.merkleRoot,
      transactionHash: anchor.transactionHash,
      blockNumber: anchor.blockNumber?.toString() ?? null,
      status: anchor.status,
      explorerUrl: anchor.explorerUrl,
      anchoredAt: anchor.anchoredAt?.toISOString() ?? null,
      confirmedAt: anchor.confirmedAt?.toISOString() ?? null,
      batch: anchor.batch,
      isOnChain: service.isOnChain,
      liveCheck: onChain,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
