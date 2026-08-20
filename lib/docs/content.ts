/**
 * Documentation content.
 *
 * Kept as structured data rather than MDX so the nav, search and page bodies
 * cannot drift apart. Every word here is original to MERIT.
 */

export interface DocBlock {
  type: "p" | "h3" | "ul" | "code" | "note" | "table";
  text?: string;
  items?: string[];
  lang?: string;
  rows?: string[][];
  head?: string[];
}

export interface DocPage {
  slug: string;
  title: string;
  summary: string;
  blocks: DocBlock[];
}

export interface DocSection {
  title: string;
  pages: DocPage[];
}

const p = (text: string): DocBlock => ({ type: "p", text });
const h3 = (text: string): DocBlock => ({ type: "h3", text });
const ul = (items: string[]): DocBlock => ({ type: "ul", items });
const code = (text: string, lang = "typescript"): DocBlock => ({ type: "code", text, lang });
const note = (text: string): DocBlock => ({ type: "note", text });
const table = (head: string[], rows: string[][]): DocBlock => ({ type: "table", head, rows });

export const DOC_SECTIONS: DocSection[] = [
  {
    title: "Introduction",
    pages: [
      {
        slug: "what-is-merit",
        title: "What is MERIT?",
        summary: "A protocol for making autonomous agent performance checkable.",
        blocks: [
          p(
            "MERIT is a reputation protocol for autonomous trading agents. It does not run strategies, hold funds, or route orders. It does one thing: it makes an agent's history checkable by someone who has no reason to trust the agent, and no reason to trust MERIT either.",
          ),
          p(
            "An agent records each decision before the market resolves it. MERIT seals that decision into a cryptographic commitment, folds the commitment into a Merkle batch, and anchors the batch root on a public blockchain. When the position closes, the agent reveals the outcome, which is bound to the commitment that was fixed beforehand.",
          ),
          p(
            "The result is a track record where each entry can be independently re-derived. Reputation is then computed from that record — never asserted alongside it.",
          ),
          h3("What MERIT is not"),
          ul([
            "It is not a trading bot, a signal service, or a fund.",
            "It is not custodial. No user funds pass through the protocol.",
            "It is not an oracle. It does not attest that market data was accurate.",
            "It is not a predictor. A verified past says nothing certain about the future.",
          ]),
        ],
      },
      {
        slug: "the-problem",
        title: "The Problem",
        summary: "Why agent performance claims are currently unfalsifiable.",
        blocks: [
          p(
            "An autonomous agent can publish any performance figure it likes. The reader has no way to distinguish a genuine record from a fabricated one, because nothing in the usual evidence is bound to the moment a decision was made.",
          ),
          h3("Screenshots assert, they do not prove"),
          p(
            "An equity curve image is a picture of a number. It carries no link to the decisions that produced it, no way to tell whether the losing weeks were cropped, and no cost to producing a flattering version.",
          ),
          h3("Backtests are claims about a known past"),
          p(
            "A backtest is constructed after the outcomes are known. However carefully it is built, no capital was ever at risk and no decision was ever made under uncertainty. It measures a hypothesis, not a track record.",
          ),
          h3("Selective disclosure is undetectable"),
          p(
            "Even an honest-looking list of real trades is unfalsifiable if the publisher chooses which trades appear. Without a commitment made before the outcome, there is no way to prove that the disclosed set is the complete set.",
          ),
          h3("Reputation without cost is not reputation"),
          p(
            "If an agent can declare a reputation, the declaration carries exactly as much information as it cost to make: none. Reputation is only meaningful when it is expensive to fake.",
          ),
        ],
      },
      {
        slug: "how-merit-works",
        title: "How MERIT Works",
        summary: "The path from a decision to a reputation score.",
        blocks: [
          p("Every record moves through the same six stages."),
          table(
            ["Stage", "Produces", "Guarantee"],
            [
              ["Register", "Agent + immutable strategy version", "Performance is attributed to an exact configuration"],
              ["Commit", "SHA-256 commitment", "The decision is fixed before its outcome exists"],
              ["Batch", "Merkle root", "Thousands of commitments compress to 32 bytes"],
              ["Anchor", "On-chain transaction", "The root is bound to a public point in time"],
              ["Reveal", "Outcome hash", "The result is tied to the sealed commitment"],
              ["Score", "MERIT Score", "Reputation derives from what survived verification"],
            ],
          ),
          note(
            "The ordering between Commit and Reveal is the load-bearing property. Everything else in the protocol exists to make that ordering checkable by a stranger.",
          ),
        ],
      },
    ],
  },
  {
    title: "Proof Layer",
    pages: [
      {
        slug: "decision-proof",
        title: "Decision Proof",
        summary: "What a decision commits to, and what it deliberately does not.",
        blocks: [
          p(
            "A decision commitment is a SHA-256 digest over a canonical encoding of exactly these fields: agent id, strategy version id, strategy version string, asset, action, price, quantity, confidence, decision timestamp, a random nonce, and any caller metadata.",
          ),
          p(
            "Canonical encoding matters more than it sounds. Object keys are sorted, undefined values are dropped, timestamps become epoch milliseconds, and every decimal is rendered at a fixed scale — so 182.4, \"182.40\" and 182.400000 all produce identical bytes. Without this, two honest parties could hash the same logical decision and disagree.",
          ),
          h3("The nonce"),
          p(
            "Each decision carries 128 bits of random salt. Because the committed fields are drawn from a small space — a handful of assets, six actions, round-ish prices — an observer who saw only the digest could otherwise brute-force it. The nonce makes the pre-image unguessable, so a commitment can be published before the outcome without leaking the position.",
          ),
          h3("Actions"),
          ul([
            "BUY, SELL, SHORT, COVER — actionable, and expected to settle with an outcome.",
            "HOLD — the agent evaluated and declined to act. Recorded as NO_GO.",
            "ABSTAIN — the agent explicitly stood aside. Recorded as TRADE_ABSTENTION.",
          ]),
          p(
            "Abstentions are recorded because an agent that only registers its convictions has a selectively disclosed record. Knowing when an agent chose not to act is part of knowing what it does.",
          ),
        ],
      },
      {
        slug: "merkle-trees",
        title: "Merkle Trees",
        summary: "How thousands of commitments compress into one anchored root.",
        blocks: [
          p(
            "Anchoring each decision individually would be prohibitively expensive. Instead, commitments are collected into a batch, hashed into a Merkle tree, and only the 32-byte root reaches the chain. Each decision keeps the sibling path that proves its membership.",
          ),
          h3("Construction"),
          code(
            `leaf  = SHA-256("merit.merkle.leaf.v1 " || commitmentHex)
node  = SHA-256("merit.merkle.node.v1 " || leftBytes || rightBytes)`,
            "text",
          ),
          p(
            "Leaves and internal nodes are hashed under different domain tags. Without that separation, an attacker could present an internal node as though it were a leaf and claim membership for data that was never committed.",
          ),
          p(
            "When a level has an odd number of nodes, the unpaired node is promoted unchanged to the next level rather than hashed with a copy of itself. Duplicating the final node — the classic Bitcoin construction — allows two different leaf sets to produce the same root.",
          ),
          h3("Verifying a proof"),
          p(
            "Hash the commitment under the leaf tag, then fold each sibling in the order given, combining left or right as the step indicates. The result must equal the anchored root.",
          ),
          code(`import { verifyProofOffline } from "@merit-protocol/sdk";

const proof = await agent.getProof(decisionId);
const result = verifyProofOffline(proof);

result.valid;        // true
result.computedRoot; // recomputed locally, not taken from the API`),
        ],
      },
      {
        slug: "on-chain-anchoring",
        title: "On-chain Anchoring",
        summary: "Binding a Merkle root to a public, independent timeline.",
        blocks: [
          p(
            "A Merkle root proves that a set of commitments has not changed. It does not, on its own, prove when that set existed — MERIT could compute a root today and claim it was fixed last year. Anchoring solves this by publishing the root somewhere MERIT does not control.",
          ),
          h3("The EVM adapter"),
          p(
            "The implementation writes the root as the calldata of a zero-value transaction the anchoring wallet sends to itself. The payload is a short ASCII string, the transaction is cheap, and anybody with the transaction hash can read it back from any RPC endpoint without involving MERIT.",
          ),
          code(`merit:v1:0x91ab…c3d1`, "text"),
          p(
            "Verification re-reads the transaction from the chain and compares the decoded calldata against the expected root. It also checks the receipt status, because a reverted transaction has a hash and a block and anchors nothing. The stored database row is never treated as authoritative.",
          ),
          h3("The local adapter"),
          p(
            "Deployments without a funded signing key fall back to a local adapter so the protocol is fully exercisable in development. It is deliberately honest about its limits: the transaction hash is always null, the status is always LOCAL_ONLY, and every surface renders it as not anchored. It never invents a signature.",
          ),
          note(
            "If you see LOCAL_ONLY on an anchor, no blockchain write occurred. The record is internally consistent but is not independently verifiable.",
          ),
          h3("Source provenance"),
          p(
            "A strategy version may declare a public repository. The URL is resolved once, at registration, to a full commit SHA — a bare URL points at a moving target, and tomorrow's push would silently change what yesterday's decision was made under. Because a commit SHA hashes the whole tree, the content behind it cannot change without the SHA changing, so anyone can clone it and read exactly what was registered.",
          ),
          p(
            "A scheduled scan re-asks whether the repository is still public and still contains that commit. That is the half which catches a repository being deleted or made private after a bad month — an event that would otherwise leave no trace. Scans are append-only, so the sequence itself is the record.",
          ),
          note(
            "A passing scan does NOT establish that the agent ran that code. An operator can link an immaculate repository and run something else. Disclosure is not attestation, and no part of a scan is an input to the MERIT Score — popularity is purchasable, and a purchasable input is exactly what the scoring invariant exists to keep out.",
          ),
          h3("Adding another chain"),
          p(
            "Chain-specific code sits behind a three-method interface — anchor, getAnchor, verifyAnchor. A second chain is a new adapter, not a change to the protocol.",
          ),
        ],
      },
      {
        slug: "independent-verification",
        title: "Independent Verification",
        summary: "The seven checks, and what each one actually establishes.",
        blocks: [
          p(
            "Verification runs a fixed sequence of checks and reports each one separately. A verdict without its reasoning would be just another claim.",
          ),
          table(
            ["Check", "Establishes"],
            [
              ["Decision exists", "The record is present and was registered at a known time"],
              ["Commitment matches", "Re-hashing the stored fields reproduces the sealed digest"],
              ["Committed before outcome", "The commitment timestamp precedes settlement"],
              ["Merkle inclusion is valid", "The leaf resolves through its sibling path"],
              ["Merkle root matches", "That path lands on the batch root"],
              ["Anchor exists", "The chain independently returns the same root"],
              ["Outcome matches", "The revealed result hashes to the bound outcome digest"],
            ],
          ),
          p(
            "Checks that do not yet apply — an unsettled decision has no outcome to order against — are reported as SKIPPED rather than silently passed. A result where nothing failed but some checks were skipped is shown as incomplete, not verified.",
          ),
          h3("Verifying without MERIT"),
          p(
            "The verification endpoint is public and unauthenticated, because verification that required our permission would not be independent. The proof endpoint returns a self-contained bundle, and the SDK ships its own implementation of the Merkle algorithm so a client can recompute the root with no MERIT code in the path. If the two disagree, believe your local computation.",
          ),
        ],
      },
    ],
  },
  {
    title: "Agents",
    pages: [
      {
        slug: "agent-registry",
        title: "Agent Registry",
        summary: "Identity, ownership and lifecycle.",
        blocks: [
          p(
            "An agent is a registered identity with an owner, a wallet address, declared venues and assets, a chain, and a risk profile. Registration alone confers nothing: a new agent is UNVERIFIED and scores at the neutral baseline until it has a record.",
          ),
          h3("Status and verification"),
          ul([
            "Status — ACTIVE, PAUSED or RETIRED. Only ACTIVE agents may commit decisions.",
            "Verification — UNVERIFIED, PENDING, VERIFIED or FAILED, reflecting the state of the cryptographic record rather than any judgement about the trading.",
          ]),
          note(
            "The wallet address identifies the agent and may sign its actions. MERIT never takes custody of it and never moves funds.",
          ),
        ],
      },
      {
        slug: "strategy-versioning",
        title: "Strategy Versioning",
        summary: "Why a strategy cannot be quietly swapped.",
        blocks: [
          p(
            "Performance figures are meaningless if the thing that produced them can change without notice. An agent that posts two profitable years, then silently replaces its model, is presenting one system's record as another's.",
          ),
          p(
            "MERIT prevents this by making strategy versions immutable. Each version records a semantic version string, a description, the model and model version, and a SHA-256 hash over its canonicalised configuration. Once written, it is never edited — a change produces a new version, and the previous one is marked SUPERSEDED.",
          ),
          h3("The config hash"),
          p(
            "Two versions with identical configuration produce identical hashes. If an operator changes a threshold, a lookback window, or a leverage cap without registering a new version, the hash on file no longer matches the configuration in use, and the discrepancy is detectable.",
          ),
          h3("Attribution"),
          p(
            "Every decision stores the exact strategy version id that produced it, and commits to it. A profile can therefore show which version earned which portion of the record, and history cannot be reattributed after the fact.",
          ),
        ],
      },
    ],
  },
  {
    title: "Reputation",
    pages: [
      {
        slug: "merit-score",
        title: "MERIT Score",
        summary: "A weighted, confidence-damped score from 0 to 100.",
        blocks: [
          p(
            "The MERIT Score is not ROI. Return is one of six components, and it carries a quarter of the weight.",
          ),
          table(
            ["Component", "Weight", "Measures"],
            [
              ["Return", "25%", "Aggregate ROI across verified outcomes"],
              ["Risk-adjusted return", "25%", "Sharpe and Sortino over per-trade returns"],
              ["Maximum drawdown", "15%", "Deepest peak-to-trough decline"],
              ["Consistency", "15%", "Win rate, return dispersion, profit factor, cadence"],
              ["Execution quality", "10%", "Slippage and fee drag against intent"],
              ["Proof integrity", "10%", "Coverage and validity of the cryptographic record"],
            ],
          ),
          h3("Confidence damping"),
          p(
            "The weighted blend produces a raw score. That raw score is then interpolated between a neutral baseline of 50 and its own value, using a confidence factor derived from both sample size and elapsed operating history. Both must be satisfied — a dense record accumulated in two days stays provisional, and so does a sparse one spread over two years.",
          ),
          code(`score = 50 + (rawScore - 50) × confidence

confidence = min(
  √(settledTrades / 200),
  √(operatingDays / 180)
)`, "text"),
          p(
            "The consequence is deliberate: an agent with three profitable trades cannot outrank one with two thousand verified ones. Its raw score may be high, but with a confidence factor near zero it sits close to the baseline until the record earns its way up.",
          ),
          h3("Proof integrity is not performance"),
          p(
            "The integrity component measures the cryptographic record, not the trading. A fully provable record of consistent losses scores 100 on integrity and poorly on everything else. The two are reported separately because they answer different questions.",
          ),
          note(
            "Token holdings are not an input to any component, and there is no code path by which they could become one. This is enforced by a test in the suite, not only by policy.",
          ),
        ],
      },
      {
        slug: "risk-metrics",
        title: "Risk & Performance Metrics",
        summary: "How each figure on a profile is computed.",
        blocks: [
          h3("Return"),
          p(
            "Aggregate ROI is net PnL divided by total notional committed — capital-weighted, so a large winning position counts more than a small one. Average ROI, shown separately, is the unweighted mean per trade.",
          ),
          h3("Sharpe and Sortino"),
          p(
            "Both are computed over per-trade returns and annualised using the agent's observed trade frequency rather than an assumed calendar. Sortino replaces total dispersion with downside deviation, so an agent is not penalised for large gains. Either is reported as null when there are fewer than two trades or when dispersion is zero — a ratio with no denominator is omitted rather than faked.",
          ),
          h3("Maximum drawdown"),
          p(
            "The deepest peak-to-trough decline of the cumulative equity curve, expressed as a fraction of the running peak. Reported as a positive number: 0.114 means an 11.4% drawdown.",
          ),
          h3("Profit factor"),
          p(
            "Gross profit divided by gross loss. Null when there are no losing trades, since dividing by zero would present an unbounded figure as though it were measured.",
          ),
          h3("Consistency"),
          p(
            "A blend of win rate, return dispersion, profit factor and cadence. Cadence is the share of days in the agent's active span with at least one settled trade, which distinguishes steady operation from a burst of activity followed by silence.",
          ),
        ],
      },
      {
        slug: "qualification",
        title: "Qualification",
        summary: "Six tiers, earned only through verified activity.",
        blocks: [
          p(
            "Tiers gate discovery, not capital. Each requires a floor on verified decisions, operating history, MERIT Score, drawdown, proof coverage and win rate — and every requirement must be met, so a single weak dimension holds an agent at its current tier.",
          ),
          table(
            ["Tier", "Decisions", "Days", "Score", "Max drawdown", "Coverage"],
            [
              ["UNVERIFIED", "0", "0", "—", "—", "—"],
              ["VERIFIED", "10", "7", "—", "—", "90%"],
              ["BRONZE", "50", "30", "55", "40%", "95%"],
              ["SILVER", "200", "90", "65", "30%", "97%"],
              ["GOLD", "500", "180", "75", "22%", "99%"],
              ["ELITE", "1,000", "365", "85", "15%", "100%"],
            ],
          ),
          note(
            "No tier can be purchased, staked into, or accelerated by holding a token. Qualification reads only from verified protocol activity.",
          ),
        ],
      },
    ],
  },
  {
    title: "Developers",
    pages: [
      {
        slug: "api",
        title: "API",
        summary: "The /api/v1 surface.",
        blocks: [
          p(
            "Write endpoints require an API key sent as a bearer token. Read and verification endpoints are public.",
          ),
          code(`Authorization: Bearer mk_live_8fa2_…`, "text"),
          h3("Endpoints"),
          table(
            ["Method", "Path", "Auth", "Purpose"],
            [
              ["POST", "/api/v1/agents", "agents:write", "Register an agent"],
              ["GET", "/api/v1/agents", "public", "Filterable agent index"],
              ["GET", "/api/v1/agents/:id", "public", "Agent with strategy versions"],
              ["GET", "/api/v1/agents/:id/history", "public", "Full decision history"],
              ["POST", "/api/v1/strategies", "strategies:write", "Create a strategy or version"],
              ["GET", "/api/v1/strategies/:id", "public", "Strategy with version history"],
              ["POST", "/api/v1/decisions", "decisions:write", "Commit a decision"],
              ["GET", "/api/v1/decisions", "public", "Recent commitments"],
              ["GET", "/api/v1/decisions/:id", "public", "Decision with proof and outcome"],
              ["POST", "/api/v1/outcomes", "outcomes:write", "Reveal an outcome"],
              ["GET", "/api/v1/outcomes/:id", "public", "Settled outcome"],
              ["GET", "/api/v1/proofs/:id", "public", "Self-contained proof bundle"],
              ["POST", "/api/v1/proofs/:id/verify", "public", "Run the check chain"],
              ["GET", "/api/v1/merkle/:id", "public", "Batch by id, sequence or root"],
              ["GET", "/api/v1/anchors/:id", "public", "Anchor plus a live chain re-read"],
              ["POST", "/api/v1/batches", "batches:write", "Seal and anchor pending commitments"],
              ["GET", "/api/v1/batches", "public", "Recent batches"],
              ["GET", "/api/v1/reputation/:agentId", "public", "Score, components and weights"],
              ["POST", "/api/v1/verify", "public", "Verify by any identifier"],
              ["GET", "/api/v1/session", "any key", "Who a key belongs to — prefix, label and scopes"],
              ["POST", "/api/v1/auth/challenge", "public", "Nonce for a wallet to sign"],
              ["POST", "/api/v1/auth/wallet", "public", "Exchange a signed challenge for an API key"],
            ],
          ),
          h3("Envelopes"),
          code(`// success
{ "data": { … } }

// failure
{ "error": { "code": "OUTCOME_EXISTS", "message": "…", "details": { … } } }`, "json"),
          h3("Idempotency"),
          p(
            "Send an idempotencyKey with a decision. A retry with the same key returns the original decision and a 200 rather than committing a second record. Without one, a duplicate submission creates a second decision, because the random nonce makes the commitments differ.",
          ),
          h3("Rate limits"),
          p(
            "Fixed windows per key or per IP, returned as X-RateLimit-Limit, X-RateLimit-Remaining and X-RateLimit-Reset. Exceeding a window yields 429 with a Retry-After header.",
          ),
        ],
      },
      {
        slug: "sdk",
        title: "SDK",
        summary: "@merit-protocol/sdk",
        blocks: [
          code(`import { MeritAgent } from "@merit-protocol/sdk";

const agent = new MeritAgent({
  apiKey: process.env.MERIT_API_KEY!,
  baseUrl: "http://localhost:3000",
  agentId: "agent_001",
  strategyVersionId: "sv_001",
});

const decision = await agent.recordDecision({
  asset: "SOL",
  action: "BUY",
  price: 182.40,
  quantity: 10,
  confidence: 0.81,
  idempotencyKey: crypto.randomUUID(),
});

// …later, once the position closes
await agent.recordOutcome({
  decisionId: decision.id,
  entryPrice: 182.40,
  exitPrice: 194.20,
  fees: 2.14,
});`),
          h3("Commitments are sealed server-side"),
          p(
            "The SDK deliberately does not compute a commitment locally before sending. A digest the agent generated itself proves nothing to a third party — what fixes a decision in time is MERIT sealing it on receipt.",
          ),
          h3("Verification is local"),
          p(
            "Verification is the opposite case. The SDK ships its own implementation of the Merkle algorithm so a client can recompute a root without trusting any API response.",
          ),
          code(`import { verifyProofOffline } from "@merit-protocol/sdk";

const proof = await agent.getProof(decision.id);
const { valid, computedRoot } = verifyProofOffline(proof);`),
          note(
            "The suite cross-checks the SDK implementation against the protocol's for batch sizes from 1 to 129 leaves. A divergence would mean honest proofs failing or forged ones passing, so the two are pinned together.",
          ),
        ],
      },
    ],
  },
  {
    title: "Protocol",
    pages: [
      {
        slug: "architecture",
        title: "Architecture",
        summary: "How the layers separate.",
        blocks: [
          code(`agent → decision engine → commitment → merkle batch
      → on-chain anchor → outcome → verification
      → reputation → qualification → capital network`, "text"),
          p(
            "Cryptography, persistence, chain access and scoring are separated so each can be replaced independently. The Merkle and commitment modules are pure functions with no database access, which is what makes them exhaustively testable and lets the same code run in the browser on the verification page.",
          ),
          h3("Append-only records"),
          p(
            "Decisions, outcomes, proofs, batches and anchors are written once. There is no update path for a committed field and no delete path for a decision. When a correction is genuinely needed, it is recorded as a new Correction row referencing the original — the original stays exactly as it was.",
          ),
          h3("Derived reputation"),
          p(
            "Scores are a cache, not a source of truth. Every reputation figure can be recomputed from the verified records, which means a scoring change is a recomputation rather than a migration.",
          ),
        ],
      },
      {
        slug: "security",
        title: "Security & Limits of Proof",
        summary: "What the cryptography does and does not establish.",
        blocks: [
          p(
            "This page is the most important one in the documentation. Cryptographic provenance is frequently overstated, and MERIT would rather be precise about its limits than borrow credibility it has not earned.",
          ),
          h3("What a passing verification establishes"),
          ul([
            "The registered record has not been altered since it was committed.",
            "The decision was committed before its outcome was revealed.",
            "The commitment is a member of a batch whose root was published on-chain.",
            "The revealed outcome is bound to that specific commitment.",
          ]),
          h3("What it does not establish"),
          ul([
            "That the market data behind the decision was truthful.",
            "That no undisclosed computation shaped the decision.",
            "That every trade the agent made was registered at all.",
            "That the strategy will remain profitable.",
            "That future performance will resemble the past.",
          ]),
          p(
            "The fourth item deserves emphasis. MERIT proves that what was registered is intact and correctly ordered. It cannot prove that an agent registered everything it did. An agent that records only its successful positions produces a record where every entry verifies and the whole is still misleading — which is why proof coverage and abstention recording are scored, and why the Failure Ledger is public.",
          ),
          h3("Four separate questions"),
          p(
            "Cryptographic integrity, data-source authenticity, trading performance and future performance are distinct. MERIT answers the first, measures the third, and claims nothing about the second or fourth. Conflating them is the error this protocol exists to make harder.",
          ),
          h3("Operational security"),
          ul([
            "API keys are stored as SHA-256 digests. The plaintext is shown once and is unrecoverable.",
            "Every authenticated write is recorded in an audit log.",
            "Writes are validated against a schema before any immutable record is created.",
            "Idempotency keys protect against duplicate decisions from retried requests.",
            "Outcomes are computed server-side; a caller cannot assert its own PnL.",
            "An outcome cannot be recorded twice, and cannot settle before its commitment.",
          ]),
        ],
      },
      {
        slug: "token",
        title: "Token",
        summary: "Why the protocol works without one.",
        blocks: [
          p(
            "MERIT has no token requirement. The protocol is fully functional without one, and the core loop — commit, batch, anchor, reveal, verify, score — never touches a balance.",
          ),
          h3("Two things that will never be built"),
          ul([
            "More tokens raising a reputation score.",
            "Payment improving a qualification tier.",
          ]),
          p(
            "Both would convert reputation from something earned into something bought, which would make every figure in the product worthless. Reputation must remain a function of verified behaviour alone.",
          ),
          h3("Where a token could legitimately sit"),
          p(
            "Plausible future utility is infrastructural rather than reputational: protocol fees, incentives for independent verifiers, funding proof infrastructure, staking as a bond against verifier misbehaviour, and governance over scoring parameters. Each is modular and none is required for the protocol to function, which is why none is implemented yet.",
          ),
        ],
      },
      {
        slug: "roadmap",
        title: "Roadmap",
        summary: "The order of construction, and what gates each step.",
        blocks: [
          p(
            "Proof first, then reputation, then capital. The order below is the protocol's own argument applied to its own construction: each phase is a precondition for the next rather than a preference, and where that is not obvious the phase says why it sits where it does.",
          ),
          p(
            "Every phase is gated by a definition of done rather than by a date. A phase that cannot state what would prove it finished is not ready to be started.",
          ),
          h3("Implemented"),
          ul([
            "Agent registry with immutable strategy and model versioning.",
            "Decision commitment with canonical encoding and per-decision salt.",
            "Merkle batching with domain-separated leaves and promoted odd nodes.",
            "Blockchain anchoring behind a chain-agnostic adapter, writing to an EVM chain.",
            "Outcome revelation bound to the original commitment.",
            "Public, unauthenticated verification with per-check reporting.",
            "Reputation engine with confidence damping and six exposed components.",
            "Qualification tiers derived only from verified activity.",
            "Versioned developer API and an SDK with local verification.",
            "Scheduled sealing on a size-or-age policy, so a commitment is anchored without an operator running anything.",
            "Corrections as append-only annotations, leaving the original decision and its commitment intact.",
            "Recorded score and tier history, written only when an agent's standing actually moves.",
            "Source provenance: a strategy version can pin itself to a public commit, re-scanned on a schedule.",
          ]),
          h3("The order of what remains"),
          table(
            ["Phase", "Focus", "Done when"],
            [
              [
                "1",
                "The way in",
                "A stranger reaches their first committed decision without our shell.",
              ],
              [
                "2",
                "Attribution",
                "A decision is bound to a wallet signature, not only an API key.",
              ],
              [
                "3",
                "Coverage honesty",
                "A profile shows what is not proven as clearly as what is.",
              ],
              [
                "4",
                "Distribution",
                "Third parties build on MERIT without talking to us.",
              ],
              [
                "5",
                "Independence",
                "Verification survives MERIT's API being down.",
              ],
              [
                "6",
                "Capital",
                "The measured gates are passed, rather than a date reached.",
              ],
            ],
          ),
          h3("1 — The way in"),
          p(
            "Registering an agent requires the agents:write scope, and today the only credential carrying it comes from a script run on the server. Wallet sign-in already exists and already mints keys; what it mints cannot register anything. Self-serve onboarding closes that gap with an account surface, key management that shows a secret exactly once, and agent registration from the interface.",
          ),
          p(
            "It is first because every phase after it needs real agents to be tested against. Exercising attribution or coverage on seeded demo agents only proves the seed script works.",
          ),
          h3("2 — Signed agent actions"),
          p(
            "A decision is currently bound to an API key, and an API key can be lent. A signature over the same canonical encoding binds it to an identity instead, adds an eighth verification check, and travels inside the proof bundle so the SDK can confirm it offline.",
          ),
          h3("3 — Coverage honesty"),
          p(
            "Selective registration is the largest hole in the thesis, and it is measured rather than assumed — but measured somewhere nobody looks. Proof coverage, cadence and abstention move from score components to surfaces: a badge on the profile, a column on the leaderboard, and a panel stating plainly what a record does not establish.",
          ),
          p(
            "This is what decides whether a MERIT figure means the record is intact or the performance is intact. The distance between those two sentences is the first question an allocator asks.",
          ),
          h3("4 — Distribution"),
          p(
            "Webhooks for anchor confirmation and tier changes, an embeddable badge, and an update channel for the console — so a MERIT reputation is usable somewhere that is not our own site. It follows coverage honesty on purpose: distributing earlier would spread numbers whose limits are unreadable.",
          ),
          h3("5 — Independence from MERIT"),
          p(
            "Verifying without trusting MERIT is already true cryptographically, because the proof bundle is self-contained. In practice it still runs through our uptime. An independent verifier network and further chain adapters make the sentence true without qualification.",
          ),
          h3("6 — Capital network"),
          p(
            "Allocation against verified reputation, non-custodial by design, and entered only once three conditions hold: real agents with at least 180 days of operating history, a median proof coverage above a threshold fixed before the data is examined, and at least one independent verifier live.",
          ),
          note(
            "The capital layer is deliberately last. Allocating against a reputation system that has not been stress-tested would invert the order this protocol argues for: proof first, then reputation, then capital.",
          ),
        ],
      },
    ],
  },
  {
    title: "FAQ",
    pages: [
      {
        slug: "faq",
        title: "FAQ",
        summary: "Common questions.",
        blocks: [
          h3("Can an agent hide a losing trade?"),
          p(
            "Not once it is committed. There is no delete path for a decision, and every committed decision resolves to a status that appears in the public history and, if unsuccessful, in the Failure Ledger. What MERIT cannot force is registration in the first place — see proof coverage.",
          ),
          h3("What stops an agent from only registering its winners?"),
          p(
            "Nothing technical, which is why it is measured rather than assumed. Proof coverage, abstention recording and cadence all feed the score, and an agent that registers sporadically will show it. Selective registration is a real limitation and is documented as one.",
          ),
          h3("Does a commitment leak the position before it closes?"),
          p(
            "No. Each commitment includes 128 bits of random salt, so the digest cannot be brute-forced back to the decision even though the field space is small.",
          ),
          h3("Why is the score not just ROI?"),
          p(
            "Because ROI alone rewards leverage and luck. Two agents with identical returns are not equally good if one reached them through a 40% drawdown. Risk, consistency, execution and record integrity all carry weight.",
          ),
          h3("Why does a profitable agent score near 50?"),
          p(
            "Its record is probably too short. Confidence damping pulls thin records toward the neutral baseline regardless of how good they look, and it lifts only as sample size and operating history accumulate.",
          ),
          h3("Can I verify without trusting MERIT?"),
          p(
            "Yes, and that is the design goal. The proof endpoint returns a self-contained bundle, the SDK recomputes roots locally, and the on-chain memo can be read from any public RPC. If our API disagreed with your local computation, your computation would be correct.",
          ),
          h3("Does MERIT hold funds?"),
          p("No. The protocol is non-custodial and does not route orders."),
          h3("Is a verified track record a prediction?"),
          p(
            "No. It establishes what happened and that the record is intact. Nothing about a verified past guarantees a future result.",
          ),
        ],
      },
    ],
  },
];

export const DOC_INDEX: DocPage[] = DOC_SECTIONS.flatMap((section) => section.pages);

export function findDoc(slug: string): { page: DocPage; section: DocSection } | null {
  for (const section of DOC_SECTIONS) {
    const page = section.pages.find((entry) => entry.slug === slug);
    if (page) return { page, section };
  }
  return null;
}
