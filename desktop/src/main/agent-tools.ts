/**
 * The operator agent's system prompt, tools, and approval gate.
 *
 * Provider-neutral on purpose. The console can run this agent on the Anthropic
 * API or through OpenRouter, and the one thing that must not fork between them
 * is the tool surface: commit_decision seals a call BEFORE the operator acts on
 * it, and that gate is the product. Two copies of these schemas would be two
 * chances for one of them to drift.
 */

import { commitDecision, listAgents, listDecisions } from "./merit";
import { getVenueAdapter } from "./venues";

export const SYSTEM = `You are the operator agent inside the MERIT Protocol console.

MERIT is a verifiable reputation layer for autonomous trading agents. Its single
governing rule is ordering: a trading decision is sealed as a cryptographic
commitment BEFORE it is executed and before its outcome is known. A record
written after the fact proves nothing.

Your job is to help the operator think through a call and, when they want it on
the record, seal it with commit_decision. You cannot execute trades — execution
happens in the operator's own wallet and venue, never here. Commit first, then
they execute.

When you propose a decision, state the asset, action, price, quantity and your
confidence, and say plainly what would make the call wrong. Put your reasoning
in the metadata field: it is sealed into the commitment alongside the numbers,
so it cannot be revised after the outcome is known.

ABSTAIN is a real answer. If conditions are unclear, say so and record the
abstention rather than manufacturing an opinion — an agent that only records its
opinions produces a misleading track record even when every entry verifies.

Keep responses focused and brief. Lead with the outcome or the recommendation;
supporting detail comes after. Deliver what the operator asked for at the scope
they intended — if you think the ask is mistaken, say so in a sentence and
continue rather than quietly redirecting.`;

export type ApprovalRequest = {
  id: string;
  summary: string;
  input: Record<string, unknown>;
};

/** Resolvers for approval prompts currently awaiting the operator. */
const pending = new Map<string, (approved: boolean) => void>();

export function resolveApproval(id: string, approved: boolean): void {
  const resolve = pending.get(id);
  if (!resolve) return;
  pending.delete(id);
  resolve(approved);
}

export interface AgentEvents {
  onText(delta: string): void;
  onToolStart(name: string): void;
  onApprovalNeeded(request: ApprovalRequest): void;
  onApprovalSettled(id: string): void;
}

function askApproval(events: AgentEvents, summary: string, input: Record<string, unknown>) {
  const id = `apr_${Math.random().toString(36).slice(2, 10)}`;

  // Register before announcing. Announcing first leaves a window in which an
  // answer arriving synchronously finds no resolver and is dropped, and the
  // tool then waits on a promise nobody can settle. The renderer replies over
  // IPC so it never hit that window, but the ordering should not be what saves
  // it — an in-process caller resolves immediately and deadlocks.
  const settled = new Promise<boolean>((resolve) => {
    pending.set(id, (approved) => {
      events.onApprovalSettled(id);
      resolve(approved);
    });
  });

  events.onApprovalNeeded({ id, summary, input });
  return settled;
}


/** One tool, in the shape each provider adapter translates from. */
export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  run(input: unknown): Promise<string>;
}

export function toolSpecs(events: AgentEvents): ToolSpec[] {
  return [
    {
      name: "list_agents",
      description:
        "List the agents registered on this MERIT deployment, with their verification status and risk profile. Call this when the operator refers to an agent by name, or when you need an agentId to commit a decision under.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      run: async (): Promise<string> => {
        events.onToolStart("list_agents");
        const result = await listAgents();
        return JSON.stringify(result);
      },
    },

    {
      name: "list_open_decisions",
      description:
        "List decisions that are committed but not yet settled — the operator's open exposure as MERIT records it. Call this when asked what is currently open, or before proposing a call that might duplicate an existing position.",
      parameters: {
        type: "object",
        properties: {
          agentId: { type: "string", description: "Restrict to one agent." },
        },
        additionalProperties: false,
      },
      run: async (input: unknown): Promise<string> => {
        events.onToolStart("list_open_decisions");
        const decisions = await listDecisions({
          agentId: (input as { agentId?: string }).agentId,
          status: "OPEN",
          limit: 50,
        });
        const venue = getVenueAdapter();
        return JSON.stringify({
          decisions,
          venue: {
            connected: venue.connected,
            note: venue.connected
              ? undefined
              : "No venue adapter is connected, so live position data is unavailable. Report only what MERIT has recorded; do not estimate venue state.",
          },
        });
      },
    },

    {
      name: "commit_decision",
      description:
        "Seal a trading decision as a cryptographic commitment on MERIT. This must be called BEFORE the operator executes the trade — that ordering is what makes the record provable. The operator must approve the commit; if they decline, the decision is not recorded and you should ask what to change.",
      parameters: {
        type: "object",
        properties: {
          agentId: { type: "string" },
          strategyVersionId: {
            type: "string",
            description: "The immutable strategy version this call was produced under.",
          },
          asset: { type: "string", description: "e.g. SOL" },
          action: {
            type: "string",
            enum: ["BUY", "SELL", "SHORT", "COVER", "HOLD", "ABSTAIN"],
          },
          price: { type: "string", description: "Decimal string, e.g. \"182.40\"" },
          quantity: { type: "string", description: "Decimal string. Use \"0\" for ABSTAIN/HOLD." },
          confidence: { type: "string", description: "Decimal string between 0 and 1." },
          rationale: {
            type: "string",
            description:
              "Why this call, and what would make it wrong. Sealed into the commitment.",
          },
        },
        required: [
          "agentId",
          "strategyVersionId",
          "asset",
          "action",
          "price",
          "quantity",
          "confidence",
          "rationale",
        ],
        additionalProperties: false,
      },
      run: async (raw: unknown): Promise<string> => {
        const input = raw as {
          agentId: string;
          strategyVersionId: string;
          asset: string;
          action: "BUY" | "SELL" | "SHORT" | "COVER" | "HOLD" | "ABSTAIN";
          price: string;
          quantity: string;
          confidence: string;
          rationale: string;
        };

        const summary = `${input.action} ${input.quantity} ${input.asset} @ ${input.price} (confidence ${input.confidence})`;
        const approved = await askApproval(events, summary, input as never);

        if (!approved) {
          return JSON.stringify({
            committed: false,
            reason:
              "The operator declined this commit. Nothing was written to MERIT. Ask what they want changed.",
          });
        }

        events.onToolStart("commit_decision");
        const receipt = await commitDecision({
          agentId: input.agentId,
          strategyVersionId: input.strategyVersionId,
          asset: input.asset,
          action: input.action,
          price: input.price,
          quantity: input.quantity,
          confidence: input.confidence,
          metadata: { rationale: input.rationale, source: "merit-console" },
          idempotencyKey: `console-${Date.now()}-${input.asset}-${input.action}`,
        });

        return JSON.stringify({ committed: true, receipt });
      },
    },
  ];
}

