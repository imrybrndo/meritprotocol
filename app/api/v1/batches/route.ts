import type { NextRequest } from "next/server";
import { getPrisma } from "@/lib/db";
import { audit, authenticate, requireScope } from "@/lib/api/auth";
import { clientIdentifier, created, ok, rateLimit, toErrorResponse, tooManyRequests } from "@/lib/api/http";
import { sealPendingBatch } from "@/lib/services/batching";

export const runtime = "nodejs";

/** POST /api/v1/batches — seal and anchor the pending commitments. */
export async function POST(request: NextRequest) {
  try {
    const key = await authenticate(request);
    requireScope(key, "batches:write");

    const limit = rateLimit(`batches:${key.id}`, 30);
    if (!limit.allowed) return tooManyRequests(limit);

    const result = await sealPendingBatch(getPrisma());
    if (!result) return ok({ batched: 0, message: "No unbatched commitments" });

    await audit({ key, action: "batch.seal", subjectId: result.batchId, request });
    return created(result);
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** GET /api/v1/batches — recent batches and their anchors. */
export async function GET(request: NextRequest) {
  try {
    const limit = rateLimit(`batches:list:${clientIdentifier(request)}`);
    if (!limit.allowed) return tooManyRequests(limit);

    const batches = await getPrisma().merkleBatch.findMany({
      orderBy: { sequence: "desc" },
      take: Math.min(100, Number(request.nextUrl.searchParams.get("limit") ?? 25)),
      include: { anchor: true },
    });

    return ok(
      batches.map((batch) => ({
        id: batch.id,
        sequence: batch.sequence,
        merkleRoot: batch.merkleRoot,
        leafCount: batch.leafCount,
        status: batch.status,
        sealedAt: batch.sealedAt?.toISOString() ?? null,
        anchor: batch.anchor
          ? {
              network: batch.anchor.network,
              transactionHash: batch.anchor.transactionHash,
              blockNumber: batch.anchor.blockNumber?.toString() ?? null,
              status: batch.anchor.status,
              explorerUrl: batch.anchor.explorerUrl,
            }
          : null,
      })),
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
