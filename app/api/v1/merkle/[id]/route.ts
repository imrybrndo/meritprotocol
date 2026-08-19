import type { NextRequest } from "next/server";
import { getPrisma } from "@/lib/db";
import { apiError, clientIdentifier, ok, rateLimit, toErrorResponse, tooManyRequests } from "@/lib/api/http";

export const runtime = "nodejs";

/** GET /api/v1/merkle/:id — batch by id, sequence number or root. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const limit = await rateLimit(`merkle:${clientIdentifier(request)}`);
    if (!limit.allowed) return tooManyRequests(limit);

    const { id } = await params;
    const sequence = Number(id);

    const batch = await getPrisma().merkleBatch.findFirst({
      where: {
        OR: [
          { id },
          { merkleRoot: id.toLowerCase() },
          ...(Number.isInteger(sequence) ? [{ sequence }] : []),
        ],
      },
      include: {
        anchor: true,
        proofs: {
          orderBy: { leafIndex: "asc" },
          take: 500,
          select: { leafIndex: true, leafHash: true, decisionId: true },
        },
      },
    });

    if (!batch) return apiError("BATCH_NOT_FOUND", "No Merkle batch matches this identifier", 404);

    return ok({
      id: batch.id,
      sequence: batch.sequence,
      merkleRoot: batch.merkleRoot,
      leafCount: batch.leafCount,
      status: batch.status,
      sealedAt: batch.sealedAt?.toISOString() ?? null,
      createdAt: batch.createdAt.toISOString(),
      anchor: batch.anchor
        ? {
            network: batch.anchor.network,
            transactionHash: batch.anchor.transactionHash,
            blockNumber: batch.anchor.blockNumber?.toString() ?? null,
            status: batch.anchor.status,
            explorerUrl: batch.anchor.explorerUrl,
          }
        : null,
      leaves: batch.proofs,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
