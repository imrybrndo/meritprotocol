/**
 * MERIT API client.
 *
 * Lives in the main process because it holds the API key. The renderer reaches
 * the protocol only through IPC, which is what keeps the credential out of web
 * content — see vault.ts.
 *
 * This talks to the deployed protocol over HTTP like any other third-party
 * client. It deliberately does NOT open a database connection: shipping
 * DATABASE_URL to end-user machines would hand every operator write access to
 * the whole protocol.
 */

import { getBaseUrl, getSecret } from "./vault";

export class MeritApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "MeritApiError";
  }
}

/**
 * The deployment could not be reached at all.
 *
 * Node's fetch throws a bare `TypeError: fetch failed` and hides the reason in
 * `cause`, which is useless in a window: it names neither the address that
 * failed nor anything to do about it. This unwraps that into a sentence an
 * operator can act on.
 */
export class DeploymentUnreachableError extends Error {
  constructor(baseUrl: string, cause: unknown) {
    super(DeploymentUnreachableError.describe(baseUrl, cause));
    this.name = "DeploymentUnreachableError";
  }

  private static describe(baseUrl: string, cause: unknown): string {
    const code = DeploymentUnreachableError.code(cause);
    const host = (() => {
      try {
        return new URL(baseUrl).host;
      } catch {
        return baseUrl;
      }
    })();

    switch (code) {
      case "ECONNREFUSED":
        return `Nothing is listening at ${baseUrl}. Start the deployment, or point the console at another one under Deployment.`;
      case "ENOTFOUND":
      case "EAI_AGAIN":
        return `Could not resolve ${host}. Check the address and this machine's connection.`;
      case "ETIMEDOUT":
      case "UND_ERR_CONNECT_TIMEOUT":
      case "UND_ERR_HEADERS_TIMEOUT":
        return `${host} did not answer in time.`;
      case "DEPTH_ZERO_SELF_SIGNED_CERT":
      case "SELF_SIGNED_CERT_IN_CHAIN":
      case "CERT_HAS_EXPIRED":
      case "ERR_TLS_CERT_ALTNAME_INVALID":
        return `${host} presented a certificate this machine will not accept (${code}).`;
      default:
        return `Could not reach ${baseUrl}${code ? ` (${code})` : ""}.`;
    }
  }

  /** The real reason is one or two `cause` hops down. */
  private static code(cause: unknown): string | null {
    for (let error = cause, depth = 0; error && depth < 4; depth += 1) {
      const candidate = error as { code?: unknown; cause?: unknown };
      if (typeof candidate.code === "string") return candidate.code;
      error = candidate.cause;
    }
    return null;
  }
}

export class MissingCredentialError extends Error {
  constructor() {
    super("No MERIT API key configured. Add one in Settings.");
    this.name = "MissingCredentialError";
  }
}

async function request<T>(
  path: string,
  init: {
    method?: string;
    body?: unknown;
    authenticated?: boolean;
    /** Overrides for sign-in, where the credential is not stored yet. */
    baseUrl?: string;
    apiKey?: string;
  } = {},
): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json" };

  if (init.authenticated) {
    const key = init.apiKey ?? getSecret("meritApiKey");
    if (!key) throw new MissingCredentialError();
    headers.authorization = `Bearer ${key}`;
  }
  if (init.body !== undefined) headers["content-type"] = "application/json";

  const baseUrl = init.baseUrl ?? getBaseUrl();
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/v1${path}`, {
      method: init.method ?? "GET",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch (error) {
    // A transport failure is not a protocol error; it never reached the API.
    throw new DeploymentUnreachableError(baseUrl, error);
  }

  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    throw new MeritApiError(response.status, text.slice(0, 300) || "Unreadable response");
  }

  if (!response.ok) {
    const detail = parsed as { error?: { message?: string } | string };
    const message =
      typeof detail.error === "string"
        ? detail.error
        : (detail.error?.message ?? `Request failed with ${response.status}`);
    throw new MeritApiError(response.status, message);
  }

  return (parsed as { data: T }).data;
}

export interface AgentSummary {
  id: string;
  slug: string;
  name: string;
  status: string;
  verificationStatus: string;
  riskProfile: string;
  chain: string;
  assets: string[];
  isDemo: boolean;
}

export interface DecisionSummary {
  id: string;
  agentId: string;
  asset: string;
  action: string;
  price: string;
  quantity: string;
  confidence: string;
  status: string;
  commitmentHash: string;
  decidedAt: string;
  committedAt: string;
  isDemo: boolean;
}

export interface DecisionReceipt {
  id: string;
  commitmentHash: string;
  status: string;
  decidedAt: string;
  committedAt: string;
  sealed: boolean;
}

export function listAgents(): Promise<{ total: number; agents: AgentSummary[] }> {
  return request("/agents?limit=100");
}

export function listDecisions(query: { agentId?: string; status?: string; limit?: number }) {
  const params = new URLSearchParams({ limit: String(query.limit ?? 50) });
  if (query.agentId) params.set("agentId", query.agentId);
  if (query.status) params.set("status", query.status);
  return request<DecisionSummary[]>(`/decisions?${params}`);
}

export interface AgentDetail extends AgentSummary {
  strategyVersions: Array<{ id: string; version: string; status: string }>;
}

/**
 * One agent with its strategy versions. A commitment must name the exact
 * version it was produced under, so an order ticket cannot seal anything
 * without asking for this first.
 */
export function getAgent(agentId: string): Promise<AgentDetail> {
  return request(`/agents/${agentId}`);
}

export function getReputation(agentId: string) {
  return request<unknown>(`/reputation/${agentId}`);
}

export interface CommitDecisionInput {
  agentId: string;
  strategyVersionId: string;
  asset: string;
  action: "BUY" | "SELL" | "SHORT" | "COVER" | "HOLD" | "ABSTAIN";
  price: string;
  quantity: string;
  confidence: string;
  metadata?: Record<string, unknown>;
  idempotencyKey?: string;
}

/**
 * Seal a decision. This must happen BEFORE the operator executes anything —
 * a commitment written after the outcome is known proves nothing.
 */
export function commitDecision(input: CommitDecisionInput): Promise<DecisionReceipt> {
  return request("/decisions", { method: "POST", body: input, authenticated: true });
}

export function revealOutcome(input: {
  decisionId: string;
  entryPrice: string;
  exitPrice: string;
  fees?: string;
  slippage?: string;
}): Promise<unknown> {
  return request("/outcomes", { method: "POST", body: input, authenticated: true });
}

export interface WalletChallenge {
  nonce: string;
  /** The exact text to sign. Never reconstructed client-side. */
  message: string;
  expiresAt: string;
}

export interface WalletSignIn {
  /** Returned once by the API and stored in the vault, never shown again. */
  apiKey: string;
  account: { id: string; walletAddress: string; createdAt: string };
  session: Session;
}

/** Public: asking for a challenge proves nothing. Only signing it does. */
export function walletChallenge(address: string, baseUrl?: string): Promise<WalletChallenge> {
  return request("/auth/challenge", { method: "POST", body: { address }, baseUrl });
}

export function walletSignIn(
  input: { address: string; nonce: string; signature: string },
  baseUrl?: string,
): Promise<WalletSignIn> {
  return request("/auth/wallet", { method: "POST", body: input, baseUrl });
}

export interface Session {
  /** Public identifier, e.g. "mk_live_8fa2". Safe to show in the window. */
  prefix: string;
  label: string;
  scopes: string[];
}

/**
 * Ask the deployment who a key belongs to. The only authenticated call that
 * writes nothing, which is what makes it usable as a sign-in check.
 */
export function session(options: { baseUrl?: string; apiKey?: string } = {}): Promise<Session> {
  return request<Session>("/session", { authenticated: true, ...options });
}

/** Reachability probe for the status bar. Public endpoint — no key required. */
export async function health(): Promise<{ reachable: boolean; agents: number | null }> {
  try {
    const result = await listAgents();
    return { reachable: true, agents: result.total };
  } catch {
    return { reachable: false, agents: null };
  }
}
