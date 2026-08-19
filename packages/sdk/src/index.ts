/**
 * @merit-protocol/sdk
 *
 * A thin, dependency-light client for recording verifiable trading decisions.
 *
 * The SDK deliberately does *not* compute commitments locally before sending.
 * A commitment that the agent generated itself proves nothing to a third party
 * — MERIT seals it server-side at the moment of receipt, which is what fixes it
 * in time. What the SDK does offer is local *verification*: `verifyProofOffline`
 * recomputes a Merkle root from a proof without trusting any API response.
 */

export * from "./verify";

export type DecisionAction = "BUY" | "SELL" | "SHORT" | "COVER" | "HOLD" | "ABSTAIN";

export interface MeritAgentOptions {
  apiKey: string;
  /** Defaults to the public API. Point at http://localhost:3000 in development. */
  baseUrl?: string;
  /** Bound to every decision unless overridden per call. */
  agentId?: string;
  strategyVersionId?: string;
  fetch?: typeof globalThis.fetch;
  /** Request timeout in milliseconds. */
  timeoutMs?: number;
}

export interface RecordDecisionInput {
  asset: string;
  action: DecisionAction;
  price: number | string;
  quantity: number | string;
  confidence?: number | string;
  agentId?: string;
  strategyVersionId?: string;
  decidedAt?: string | Date;
  expiresAt?: string | Date;
  metadata?: Record<string, unknown>;
  /** Retry-safe key. Replays return the original decision rather than a new one. */
  idempotencyKey?: string;
}

export interface DecisionReceipt {
  id: string;
  commitmentHash: string;
  status: string;
  decidedAt: string;
  committedAt: string;
  sealed: boolean;
}

export interface RecordOutcomeInput {
  decisionId: string;
  exitPrice: number | string;
  entryPrice?: number | string;
  quantity?: number | string;
  fees?: number | string;
  slippage?: number | string;
  settledAt?: string | Date;
}

export interface OutcomeReceipt {
  id: string;
  decisionId: string;
  outcomeHash: string;
  grossPnl: string;
  realizedPnl: string;
  roi: string;
  notional: string;
  holdingPeriodMs: number;
  status: string;
}

export interface ProofBundle {
  id: string;
  decisionId: string;
  commitmentHash: string;
  leafHash: string;
  leafIndex: number;
  path: Array<{ sibling: string; side: "left" | "right" }>;
  merkleRoot: string;
  batch: { id: string; sequence: number; leafCount: number; status: string };
  anchor: {
    network: string;
    transactionHash: string | null;
    blockNumber: string | null;
    status: string;
    explorerUrl: string | null;
    anchoredAt: string | null;
  } | null;
  algorithm: {
    hash: string;
    leafDomain: string;
    nodeDomain: string;
    unpairedNodes: string;
  };
}

export interface VerificationCheck {
  id: string;
  label: string;
  state: "PASS" | "FAIL" | "SKIPPED";
  detail: string;
}

export interface VerificationResult {
  valid: boolean;
  partial: boolean;
  checks: VerificationCheck[];
  decision: Record<string, unknown> | null;
  outcome: Record<string, unknown> | null;
  proof: Record<string, unknown> | null;
  anchor: Record<string, unknown> | null;
}

export class MeritApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "MeritApiError";
  }
}

const DEFAULT_BASE_URL = "https://api.merit.protocol";

export class MeritAgent {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: MeritAgentOptions) {
    if (!options.apiKey) throw new Error("MeritAgent requires an apiKey");

    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  private async request<T>(
    path: string,
    init: RequestInit & { authenticated?: boolean } = {},
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(`${this.baseUrl}/api/v1${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          ...(init.authenticated === false
            ? {}
            : { authorization: `Bearer ${this.options.apiKey}` }),
          ...init.headers,
        },
      });

      const body = (await response.json().catch(() => null)) as
        | { data?: T; error?: { code: string; message: string; details?: unknown } }
        | null;

      if (!response.ok) {
        throw new MeritApiError(
          body?.error?.message ?? `Request failed with ${response.status}`,
          body?.error?.code ?? "UNKNOWN",
          response.status,
          body?.error?.details,
        );
      }

      return body!.data as T;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Commit a decision. Returns once MERIT has sealed the commitment — which,
   * by construction, is before the outcome can be known.
   */
  async recordDecision(input: RecordDecisionInput): Promise<DecisionReceipt> {
    const agentId = input.agentId ?? this.options.agentId;
    const strategyVersionId = input.strategyVersionId ?? this.options.strategyVersionId;

    if (!agentId) throw new Error("agentId is required (pass it here or to the constructor)");
    if (!strategyVersionId) {
      throw new Error("strategyVersionId is required (pass it here or to the constructor)");
    }

    return this.request<DecisionReceipt>("/decisions", {
      method: "POST",
      body: JSON.stringify({
        agentId,
        strategyVersionId,
        asset: input.asset,
        action: input.action,
        price: input.price,
        quantity: input.quantity,
        confidence: input.confidence ?? 0.5,
        decidedAt: toIso(input.decidedAt),
        expiresAt: toIso(input.expiresAt),
        metadata: input.metadata,
        idempotencyKey: input.idempotencyKey,
      }),
    });
  }

  /** Reveal the result. PnL and ROI are computed server-side, not accepted. */
  async recordOutcome(input: RecordOutcomeInput): Promise<OutcomeReceipt> {
    return this.request<OutcomeReceipt>("/outcomes", {
      method: "POST",
      body: JSON.stringify({
        decisionId: input.decisionId,
        entryPrice: input.entryPrice,
        exitPrice: input.exitPrice,
        quantity: input.quantity,
        fees: input.fees ?? 0,
        slippage: input.slippage ?? 0,
        settledAt: toIso(input.settledAt),
      }),
    });
  }

  /** Fetch the self-contained proof bundle for a decision. */
  async getProof(decisionId: string): Promise<ProofBundle> {
    return this.request<ProofBundle>(`/proofs/${decisionId}`, {
      method: "GET",
      authenticated: false,
    });
  }

  /** Ask MERIT to run the full check chain. */
  async verify(query: string): Promise<VerificationResult> {
    return this.request<VerificationResult>("/verify", {
      method: "POST",
      authenticated: false,
      body: JSON.stringify({ query, type: "auto" }),
    });
  }

  /** Current reputation for an agent, with the components and weights. */
  async getReputation(agentId?: string): Promise<Record<string, unknown>> {
    const id = agentId ?? this.options.agentId;
    if (!id) throw new Error("agentId is required");
    return this.request(`/reputation/${id}`, { method: "GET", authenticated: false });
  }

  /** Full decision history, losses included. */
  async getHistory(
    agentId?: string,
    options: { limit?: number; offset?: number; status?: string } = {},
  ): Promise<Record<string, unknown>> {
    const id = agentId ?? this.options.agentId;
    if (!id) throw new Error("agentId is required");

    const params = new URLSearchParams();
    if (options.limit) params.set("limit", String(options.limit));
    if (options.offset) params.set("offset", String(options.offset));
    if (options.status) params.set("status", options.status);

    const suffix = params.size > 0 ? `?${params.toString()}` : "";
    return this.request(`/agents/${id}/history${suffix}`, {
      method: "GET",
      authenticated: false,
    });
  }

  /** Seal and anchor the pending batch. Requires the batches:write scope. */
  async sealBatch(): Promise<Record<string, unknown>> {
    return this.request("/batches", { method: "POST" });
  }
}

function toIso(value: string | Date | undefined): string | undefined {
  if (value === undefined) return undefined;
  return value instanceof Date ? value.toISOString() : value;
}
