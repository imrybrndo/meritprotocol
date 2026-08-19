import type { NextRequest } from "next/server";
import { getPrisma } from "@/lib/db";
import { audit, authenticate, requireScope } from "@/lib/api/auth";
import {
  clientIdentifier,
  created,
  ok,
  parseBody,
  rateLimit,
  rateLimitHeaders,
  toErrorResponse,
  tooManyRequests,
} from "@/lib/api/http";
import { createAgentSchema, listAgentsSchema } from "@/lib/validation/schemas";
import { emitEvent } from "@/lib/events";
import { buildAgentSummaries } from "@/lib/services/queries";
import { applyFilters } from "@/lib/services/filters";
import { ProtocolError } from "@/lib/services/decisions";

export const runtime = "nodejs";

/** POST /api/v1/agents — register an agent. */
export async function POST(request: NextRequest) {
  try {
    const key = await authenticate(request);
    requireScope(key, "agents:write");

    const limit = await rateLimit(`agents:${key.id}`, 60);
    if (!limit.allowed) return tooManyRequests(limit);

    const body = await parseBody(request, createAgentSchema);
    const prisma = getPrisma();

    const existing = await prisma.agent.findUnique({
      where: { slug: body.slug },
      select: { id: true },
    });
    if (existing) {
      throw new ProtocolError("An agent with this slug already exists", "SLUG_TAKEN", 409);
    }

    const agent = await prisma.$transaction(async (tx) => {
      const record = await tx.agent.create({
        data: {
          slug: body.slug,
          name: body.name,
          description: body.description,
          ownerId: key.userId,
          walletAddress: body.walletAddress,
          venues: body.venues,
          assets: body.assets,
          chain: body.chain,
          riskProfile: body.riskProfile,
        },
      });

      await emitEvent(tx, {
        type: "AGENT_CREATED",
        agentId: record.id,
        subjectId: record.id,
        payload: { slug: record.slug, chain: record.chain },
      });

      return record;
    });

    await audit({ key, action: "agent.create", subjectId: agent.id, request });

    return created({
      id: agent.id,
      slug: agent.slug,
      name: agent.name,
      status: agent.status,
      verificationStatus: agent.verificationStatus,
      createdAt: agent.createdAt.toISOString(),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** GET /api/v1/agents — public, filterable agent index. */
export async function GET(request: NextRequest) {
  try {
    const limit = await rateLimit(`agents:list:${clientIdentifier(request)}`);
    if (!limit.allowed) return tooManyRequests(limit);

    const query = listAgentsSchema.parse(
      Object.fromEntries(request.nextUrl.searchParams.entries()),
    );

    const summaries = await buildAgentSummaries(200);
    const filtered = applyFilters(summaries, query);

    return ok(
      {
        total: filtered.length,
        agents: filtered.slice(query.offset, query.offset + query.limit),
      },
      { headers: rateLimitHeaders(limit) },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
