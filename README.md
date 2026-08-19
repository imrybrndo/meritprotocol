# MERIT Protocol

**The verifiable reputation layer for autonomous agents.**

> Don't trust the track record. Verify it.

MERIT turns autonomous trading decisions into cryptographically verifiable
historical records, so agents build reputation through proven performance rather
than claims.

An agent records a decision *before* the market resolves it. MERIT seals it into
a SHA-256 commitment, folds that commitment into a Merkle batch, and anchors the
batch root on-chain. When the position closes, the outcome is revealed and bound
to the commitment that was already fixed. Anyone can then re-derive the whole
chain without trusting the agent — or MERIT.

---

## Setup

Requires Node 20+ and a PostgreSQL 14+ database.

```bash
npm install
cp .env.example .env          # then set DATABASE_URL
npm run db:generate           # generate the Prisma client
npm run db:push               # create the schema
npm run db:seed               # load five demo agents (~8,400 decisions)
npm run dev                   # http://localhost:3000
```

`DATABASE_URL` accepts any Postgres connection string — Neon and Supabase both
work. Without one the app still boots: every page renders with an explicit
"no database connection" notice rather than fabricated zeros.

### Verify the build

```bash
npm run verify        # typecheck + lint + unit tests
npm test              # 95 unit tests
DATABASE_URL=… npm test   # additionally runs the 10 integration tests
```

---

## Anchoring

The chain adapter is selected by configuration.

| Adapter | When | Transaction hash | Status |
| --- | --- | --- | --- |
| `LocalAnchorAdapter` | no keypair configured | always `null` | `LOCAL_ONLY` |
| `SolanaAnchorAdapter` | `SOLANA_ANCHOR_SECRET_KEY` set | real signature | `CONFIRMED` |

The local adapter exists so the protocol is fully exercisable without a funded
wallet. It is deliberately honest about what it is: **it never fabricates a
transaction hash**, and every surface renders `LOCAL_ONLY` anchors as *not*
third-party verifiable.

To anchor for real on devnet:

```bash
solana-keygen new --outfile merit-anchor.json
solana airdrop 1 --keypair merit-anchor.json --url devnet
# then in .env:
#   SOLANA_ANCHOR_SECRET_KEY=<contents of merit-anchor.json>
#   SOLANA_CLUSTER=devnet
```

Roots are written as SPL Memo instructions (`merit:v1:0x…`), readable from any
public RPC endpoint with no MERIT involvement.

---

## Architecture

```
lib/crypto/       canonical encoding, commitments, Merkle tree   (pure, no I/O)
lib/anchor/       AnchorService interface + Local and Solana adapters
lib/reputation/   metrics and the scoring engine                 (pure, no I/O)
lib/qualification tier requirements
lib/services/     decision, batching, verification, read models
lib/api/          auth, rate limiting, HTTP envelopes
app/(site)/       landing, marketplace, profiles, verify, leaderboard, dashboard, docs
app/api/v1/       19 endpoints
packages/sdk/     @merit-protocol/sdk, including local proof verification
prisma/           16 models, 62 indexes, seed script
tests/            105 tests
```

The cryptographic and scoring modules are pure functions with no database
access. That is what makes them exhaustively testable, and what lets the same
Merkle code run in a browser on `/verify`.

### Append-only by construction

Decisions, outcomes, proofs, batches and anchors are written once. There is no
update path for a committed field and **no delete path for a decision** —
hiding a loss is the precise failure this protocol exists to prevent. Genuine
corrections are new `Correction` rows referencing the original.

---

## The verification chain

`/verify` accepts a decision ID, commitment hash, or anchor transaction hash and
runs seven checks, reporting each one separately:

1. Decision exists
2. Commitment matches — the stored fields re-hash to the sealed digest
3. Committed before outcome
4. Merkle inclusion is valid
5. Merkle root matches the batch
6. Blockchain anchor exists — re-read from the chain, not the database
7. Outcome matches the bound digest

Checks that do not yet apply are reported `SKIPPED`, and a result with skips is
shown as *incomplete*, never as verified.

### Verifying without MERIT

`POST /api/v1/verify` and `GET /api/v1/proofs/:id` are public and
unauthenticated — verification that required our permission would not be
independent. The proof endpoint returns a self-contained bundle, and the SDK
ships its own Merkle implementation:

```ts
import { verifyProofOffline } from "@merit-protocol/sdk";

const proof = await agent.getProof(decisionId);
const { valid, computedRoot } = verifyProofOffline(proof);
```

The suite cross-checks that implementation against the protocol's for batch
sizes from 1 to 129 leaves. If they ever disagreed, honest proofs would fail or
forged ones would pass.

---

## MERIT Score

Not ROI. Six weighted components:

| Component | Weight |
| --- | --- |
| Return | 25% |
| Risk-adjusted return | 25% |
| Maximum drawdown | 15% |
| Consistency | 15% |
| Execution quality | 10% |
| Proof integrity | 10% |

The blend is then damped toward a neutral baseline of 50 by a confidence factor
drawn from **both** sample size and elapsed operating history:

```
score      = 50 + (rawScore - 50) × confidence
confidence = min( √(trades / 200), √(days / 180) )
```

So three lucky trades cannot outrank two thousand verified ones. Token holdings
are not an input to any component — enforced by a test, not only by policy.

---

## SDK

```ts
import { MeritAgent } from "@merit-protocol/sdk";

const agent = new MeritAgent({
  apiKey: process.env.MERIT_API_KEY!,
  baseUrl: "http://localhost:3000",
  agentId: "agent_001",
  strategyVersionId: "sv_001",
});

const decision = await agent.recordDecision({
  asset: "SOL", action: "BUY", price: 182.40, quantity: 10,
});

await agent.recordOutcome({
  decisionId: decision.id, entryPrice: 182.40, exitPrice: 194.20,
});
```

Commitments are sealed server-side on purpose: a digest the agent generated
itself proves nothing to a third party.

---

## Demo data

`npm run db:seed` loads five agents — Alpha Momentum, Delta Arbitrage, Nova Mean
Reversion, Atlas Market Maker and Orion Funding — with roughly 8,400 decisions
across 400 days of simulated history.

Every seeded record goes through the real commitment, batching and anchoring
code, so **the proofs genuinely verify**. The trading is simulated: prices
follow a seeded random walk. All seeded records carry `isDemo` and are labelled
`DEMO` throughout the interface, so demo performance is never presented as live.

---

## What proof does and does not establish

A passing verification establishes that the registered record is unaltered,
correctly ordered, and anchored to a public timeline.

It does **not** establish that the market data behind a decision was truthful,
that no undisclosed computation shaped it, that every trade the agent made was
registered at all, that the strategy will remain profitable, or anything about
future performance.

Cryptographic integrity, data-source authenticity, trading performance and
future performance are four separate questions. MERIT answers the first,
measures the third, and claims nothing about the second or fourth.

Full discussion: `/docs/security`.

---

## Scope

Implemented through the reputation and qualification layer. The capital network
is a roadmap item and deliberately last — allocating against an unproven
reputation system would invert the order this protocol argues for. **MERIT is
non-custodial and holds no user funds.**

---

## Also in this repo

`/vantage` — an unrelated landing-page composition kept from earlier work. It is
self-contained under `app/vantage/` and shares nothing with MERIT beyond the
Next.js app shell.
