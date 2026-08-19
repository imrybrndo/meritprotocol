import type { NextRequest } from "next/server";
import { getPrisma } from "@/lib/db";
import { apiError, clientIdentifier, ok, rateLimit, toErrorResponse, tooManyRequests } from "@/lib/api/http";

export const runtime = "nodejs";

/** GET /api/v1/strategies/:id — strategy with its full immutable version history. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const limit = rateLimit(`strategy:${clientIdentifier(request)}`);
    if (!limit.allowed) return tooManyRequests(limit);

    const { id } = await params;
    const strategy = await getPrisma().strategy.findFirst({
      where: { OR: [{ id }, { versions: { some: { id } } }] },
      include: {
        agent: { select: { id: true, slug: true, name: true } },
        versions: { orderBy: { createdAt: "asc" } },
      },
    });

    if (!strategy) return apiError("STRATEGY_NOT_FOUND", "No strategy matches this identifier", 404);

    return ok({
      id: strategy.id,
      name: strategy.name,
      description: strategy.description,
      agent: strategy.agent,
      createdAt: strategy.createdAt.toISOString(),
      versions: strategy.versions.map((version) => ({
        id: version.id,
        version: version.version,
        description: version.description,
        model: version.model,
        modelVersion: version.modelVersion,
        configHash: version.configHash,
        config: version.config,
        creatorSignature: version.creatorSignature,
        status: version.status,
        createdAt: version.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
