/**
 * Append-only protocol event log.
 *
 * Every state transition that matters to an outside observer is recorded here.
 * Nothing in the codebase updates or deletes an event; the log is the audit
 * trail that makes the rest of the protocol reconstructible.
 */

import type { Prisma, PrismaClient } from "../generated/prisma/client";

export const EVENT_TYPES = [
  "AGENT_CREATED",
  "STRATEGY_REGISTERED",
  "VERSION_CREATED",
  "DECISION_COMMITTED",
  "TRADE_EXECUTED",
  "OUTCOME_REVEALED",
  "PROOF_BATCHED",
  "MERKLE_ROOT_CREATED",
  "ANCHOR_CONFIRMED",
  "REPUTATION_UPDATED",
  "CORRECTION_RECORDED",
  "VERIFICATION_REQUESTED",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export interface EmitEventInput {
  type: EventType;
  agentId?: string | null;
  subjectId?: string | null;
  payload: Prisma.InputJsonValue;
}

type Client = PrismaClient | Prisma.TransactionClient;

/** Record a protocol event. Safe to call inside a transaction. */
export async function emitEvent(client: Client, input: EmitEventInput): Promise<void> {
  await client.protocolEvent.create({
    data: {
      type: input.type,
      agentId: input.agentId ?? null,
      subjectId: input.subjectId ?? null,
      payload: input.payload,
    },
  });
}

/** Human-readable labels for the timeline UI. */
export const EVENT_LABELS: Record<EventType, string> = {
  AGENT_CREATED: "Agent registered",
  STRATEGY_REGISTERED: "Strategy registered",
  VERSION_CREATED: "Strategy version created",
  DECISION_COMMITTED: "Decision committed",
  TRADE_EXECUTED: "Trade executed",
  OUTCOME_REVEALED: "Outcome revealed",
  PROOF_BATCHED: "Proof batched",
  MERKLE_ROOT_CREATED: "Merkle root created",
  ANCHOR_CONFIRMED: "Anchor confirmed",
  REPUTATION_UPDATED: "Reputation recomputed",
  CORRECTION_RECORDED: "Correction recorded",
  VERIFICATION_REQUESTED: "Verification requested",
};
