import type { NextRequest } from "next/server";
import { getPrisma } from "@/lib/db";
import { audit, authenticate, requireScope } from "@/lib/api/auth";
import { created, parseBody, rateLimit, toErrorResponse, tooManyRequests } from "@/lib/api/http";
import { createStrategySchema, createStrategyVersionSchema } from "@/lib/validation/schemas";
import { hashStrategyConfig } from "@/lib/crypto/hash";
import { emitEvent } from "@/lib/events";
import { ProtocolError } from "@/lib/services/decisions";

export const runtime = "nodejs";

/**
 * POST /api/v1/strategies
 *
 * Body with `strategyId` registers a new immutable version; body with `agentId`
 * creates the strategy itself. Existing versions are never modified.
 */
export async function POST(request: NextRequest) {
  try {
    const key = await authenticate(request);
    requireScope(key, "strategies:write");

    const limit = rateLimit(`strategies:${key.id}`, 120);
    if (!limit.allowed) return tooManyRequests(limit);

    const raw = (await request.clone().json().catch(() => ({}))) as Record<string, unknown>;
    const prisma = getPrisma();

    if (typeof raw.strategyId === "string") {
      const body = await parseBody(request, createStrategyVersionSchema);

      const strategy = await prisma.strategy.findUnique({
        where: { id: body.strategyId },
        select: { id: true, agentId: true, agent: { select: { ownerId: true } } },
      });
      if (!strategy) throw new ProtocolError("Strategy not found", "STRATEGY_NOT_FOUND", 404);
      if (strategy.agent.ownerId !== key.userId) {
        throw new ProtocolError("You do not own this strategy", "NOT_OWNER", 403);
      }

      const duplicate = await prisma.strategyVersion.findFirst({
        where: { strategyId: body.strategyId, version: body.version },
        select: { id: true },
      });
      if (duplicate) {
        throw new ProtocolError(
          "This version already exists and cannot be rewritten",
          "VERSION_EXISTS",
          409,
        );
      }

      const version = await prisma.$transaction(async (tx) => {
        // Previous versions are superseded, never edited or deleted.
        await tx.strategyVersion.updateMany({
          where: { strategyId: body.strategyId, status: "ACTIVE" },
          data: { status: "SUPERSEDED" },
        });

        const record = await tx.strategyVersion.create({
          data: {
            strategyId: body.strategyId,
            version: body.version,
            description: body.description,
            model: body.model,
            modelVersion: body.modelVersion,
            configHash: hashStrategyConfig(body.config as Record<string, never>),
            config: body.config as never,
            creatorSignature: body.creatorSignature ?? null,
            status: "ACTIVE",
          },
        });

        await emitEvent(tx, {
          type: "VERSION_CREATED",
          agentId: strategy.agentId,
          subjectId: record.id,
          payload: { version: record.version, configHash: record.configHash },
        });

        return record;
      });

      await audit({ key, action: "strategy.version.create", subjectId: version.id, request });

      return created({
        id: version.id,
        version: version.version,
        configHash: version.configHash,
        model: version.model,
        modelVersion: version.modelVersion,
        status: version.status,
        createdAt: version.createdAt.toISOString(),
      });
    }

    const body = await parseBody(request, createStrategySchema);
    const agent = await prisma.agent.findUnique({
      where: { id: body.agentId },
      select: { id: true, ownerId: true },
    });
    if (!agent) throw new ProtocolError("Agent not found", "AGENT_NOT_FOUND", 404);
    if (agent.ownerId !== key.userId) {
      throw new ProtocolError("You do not own this agent", "NOT_OWNER", 403);
    }

    const strategy = await prisma.$transaction(async (tx) => {
      const record = await tx.strategy.create({
        data: { agentId: agent.id, name: body.name, description: body.description },
      });

      await emitEvent(tx, {
        type: "STRATEGY_REGISTERED",
        agentId: agent.id,
        subjectId: record.id,
        payload: { name: record.name },
      });

      return record;
    });

    await audit({ key, action: "strategy.create", subjectId: strategy.id, request });

    return created({
      id: strategy.id,
      agentId: strategy.agentId,
      name: strategy.name,
      createdAt: strategy.createdAt.toISOString(),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
