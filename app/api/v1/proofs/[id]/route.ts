import type { NextRequest } from "next/server";
import { getPrisma } from "@/lib/db";
import { apiError, clientIdentifier, ok, rateLimit, toErrorResponse, tooManyRequests } from "@/lib/api/http";

export const runtime = "nodejs";

/**
 * GET /api/v1/proofs/:id — everything needed to verify offline.
 *
 * The response is self-contained: leaf, path, root and anchor. A client can
 * recompute the root without calling MERIT again.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const limit = await rateLimit(`proof:${clientIdentifier(request)}`);
    if (!limit.allowed) return tooManyRequests(limit);

    const { id } = await params;
    const proof = await getPrisma().proof.findFirst({
      where: { OR: [{ id }, { decisionId: id }] },
      include: {
        decision: { select: { id: true, commitmentHash: true, agentId: true } },
        batch: { include: { anchor: true } },
      },
    });

    if (!proof) return apiError("PROOF_NOT_FOUND", "No proof matches this identifier", 404);

    return ok({
      id: proof.id,
      decisionId: proof.decisionId,
      commitmentHash: proof.decision.commitmentHash,
      leafHash: proof.leafHash,
      leafIndex: proof.leafIndex,
      path: proof.path,
      merkleRoot: proof.batch.merkleRoot,
      batch: {
        id: proof.batch.id,
        sequence: proof.batch.sequence,
        leafCount: proof.batch.leafCount,
        status: proof.batch.status,
      },
      anchor: proof.batch.anchor
        ? {
            network: proof.batch.anchor.network,
            transactionHash: proof.batch.anchor.transactionHash,
            blockNumber: proof.batch.anchor.blockNumber?.toString() ?? null,
            status: proof.batch.anchor.status,
            explorerUrl: proof.batch.anchor.explorerUrl,
            anchoredAt: proof.batch.anchor.anchoredAt?.toISOString() ?? null,
          }
        : null,
      algorithm: {
        hash: "SHA-256",
        leafDomain: "merit.merkle.leaf.v1",
        nodeDomain: "merit.merkle.node.v1",
        unpairedNodes: "promoted",
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
