import type { NextRequest } from "next/server";
import { getPrisma } from "@/lib/db";
import { clientIdentifier, ok, rateLimit, toErrorResponse, tooManyRequests } from "@/lib/api/http";
import { apiError } from "@/lib/api/http";
import { buildAgentSummaries } from "@/lib/services/queries";

export const runtime = "nodejs";

/** GET /api/v1/agents/:id — accepts an agent id or its slug. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const limit = rateLimit(`agent:${clientIdentifier(request)}`);
    if (!limit.allowed) return tooManyRequests(limit);

    const { id } = await params;
    const summaries = await buildAgentSummaries(500);
    const agent = summaries.find((entry) => entry.id === id || entry.slug === id);

    if (!agent) return apiError("AGENT_NOT_FOUND", "No agent matches this identifier", 404);

    const versions = await getPrisma().strategyVersion.findMany({
      where: { strategy: { agentId: agent.id } },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        version: true,
        model: true,
        modelVersion: true,
        configHash: true,
        status: true,
        createdAt: true,
      },
    });

    return ok({
      ...agent,
      createdAt: agent.createdAt.toISOString(),
      strategyVersions: versions.map((version) => ({
        ...version,
        createdAt: version.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
