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
npm test              # 128 unit tests
DATABASE_URL=… npm test   # additionally runs the 18 integration tests
```

---

## Anchoring

The chain adapter is selected by configuration.

| Adapter | When | Transaction hash | Status |
| --- | --- | --- | --- |
| `LocalAnchorAdapter` | no signing key configured | always `null` | `LOCAL_ONLY` |
| `EvmAnchorAdapter` | `EVM_ANCHOR_PRIVATE_KEY` **and** `EVM_RPC_URL` set | real hash | `CONFIRMED` |

The local adapter exists so the protocol is fully exercisable without a funded
wallet. It is deliberately honest about what it is: **it never fabricates a
transaction hash**, and every surface renders `LOCAL_ONLY` anchors as *not*
third-party verifiable.

To anchor for real:

```bash
# in .env:
#   EVM_ANCHOR_PRIVATE_KEY=0x…      the wallet that pays gas
#   EVM_RPC_URL=https://…           no default; see below
#   EVM_CHAIN_ID=…                  checked against the RPC before the first write
#   EVM_CHAIN_NAME=robinhood        label used throughout the interface
#   EVM_EXPLORER_URL=https://…      optional; `/tx/<hash>` is appended
```

There is deliberately no default RPC URL. Public Solana clusters had well-known
endpoints; an EVM deployment does not, and guessing one would mean anchoring to
whatever chain the guess happened to hit. A key with no RPC URL logs the mistake
and stays on the local adapter rather than pretending to be configured.

`EVM_CHAIN_ID` is checked against what the RPC actually reports before the first
write. A mismatch aborts: anchors that confirm on an unexpected chain cost money
and prove nothing about the chain the protocol claims to be on, and that failure
is silent unless something checks.

Roots are written as the calldata of a zero-value transaction the anchoring
wallet sends to itself — `merit:v1:0x…` in UTF-8, readable from any RPC endpoint
with no MERIT involvement. No contract is deployed on purpose: a registry
contract would buy nicer indexing at the price of a deployment, an owner, and a
story about what happens when the owner key is lost, none of which the protocol
needs when every root is already re-derivable from the proof bundle.

Verification re-reads the transaction and checks the receipt status as well as
the payload. A reverted transaction has a hash and a block and anchors nothing.

---

## Sealing

A commitment is only anchored once it lands in a batch, so the schedule that
seals batches is part of the protocol rather than an operational detail. Two
conditions trigger a seal, whichever comes first:

| Trigger | Variable | Default | Why |
| --- | --- | --- | --- |
| Backlog size | `MERIT_SEAL_MIN_BATCH` | 32 | One anchor transaction covers the whole batch, so larger batches are cheaper per commitment. |
| Commitment age | `MERIT_SEAL_MAX_AGE_MINUTES` | 60 | Without it, a single decision in a quiet week stays unproven indefinitely. |

`vercel.ts` runs `/api/cron/seal` every ten minutes. That is how often the
question is asked; the thresholds above decide the answer, and most runs
correctly do nothing. To seal less often, raise the thresholds rather than
slowing the schedule — the interval sets the accuracy of the age trigger.

Both scheduled routes require `Authorization: Bearer $CRON_SECRET`. With no
secret set they refuse to run in production rather than leaving an endpoint open
that seals batches and pays for anchor transactions.

```bash
# what a run would do, without doing it
curl -H "Authorization: Bearer $CRON_SECRET" https://…/api/cron/seal
```

Sealing is safe to run concurrently. The pending set is claimed inside the
transaction with `FOR UPDATE SKIP LOCKED`, so the scheduler and a manual
`POST /api/v1/batches` take disjoint sets rather than racing for the same
commitments. `npm run anchor:pending` remains the way to re-anchor batches
sealed while no signing key was configured.

---

## Architecture

```
lib/crypto/       canonical encoding, commitments, Merkle tree   (pure, no I/O)
lib/anchor/       AnchorService interface + Local and EVM adapters
lib/reputation/   metrics and the scoring engine                 (pure, no I/O)
lib/qualification tier requirements
lib/services/     decision, batching, corrections, reputation, verification, reads
lib/api/          auth, rate limiting, scheduler auth, HTTP envelopes
app/(site)/       landing, marketplace, profiles, verify, leaderboard, dashboard, docs
app/api/v1/       20 endpoints
app/api/cron/     the scheduled seal and reputation runs
packages/sdk/     @merit-protocol/sdk, including local proof verification
prisma/           16 models, 62 indexes, seed script
tests/            128 tests
```

The cryptographic and scoring modules are pure functions with no database
access. That is what makes them exhaustively testable, and what lets the same
Merkle code run in a browser on `/verify`.

### Append-only by construction

Decisions, outcomes, proofs, batches and anchors are written once. There is no
update path for a committed field and **no delete path for a decision** —
hiding a loss is the precise failure this protocol exists to prevent.

Genuine corrections go through `POST /api/v1/corrections`, which is deliberately
not an edit. The original decision, its commitment and its outcome are untouched
and still verify; the correction is a new row pointing at them, timestamped
after the fact and public at `GET /api/v1/corrections?decisionId=…`. Every row
in an agent's history carries its correction count, so an amended record reads
as amended from the same request that returns it. A decision accepts at most
five, because an unbounded amendment channel would let a record be rewritten by
burial.

Reputation is recorded the same way. Scores used to be derived per request and
never stored, which left the protocol with no memory of its own judgements — no
score from before a drawdown, no timestamp on a promotion. `/api/cron/reputation`
now writes a `ReputationScore` and a `Qualification` row whenever an agent's
score or tier actually moves, and never when it has not, so the table holds
transitions rather than a row per agent per hour. Read it from
`GET /api/v1/reputation/:agentId?history=1`.

Both the profile and the stored history come from one derivation in
`lib/services/agent-picture.ts`, and a test fails the build if any other module
computes a score itself. A protocol arguing that its numbers are re-derivable
cannot publish one figure and store another.

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

## Desktop build

The macOS console is packaged separately and hosted off the deployment — disk
images are excluded from both Git and the Vercel build, so a site-relative path
could only ever resolve on the developer's machine.

Publishing one is three steps: build it, upload the artefacts as GitHub release
assets under a tag, then set `MERIT_DESKTOP_RELEASE_TAG` **and** the per-arch
`…_SHA256` variables. The checksum is not decoration — a build without one is
rendered as "Not published", because a tag is a string somebody typed and a
digest is evidence they held the file.

Even that is only evidence, not proof, so the last step is to ask the host:

```bash
npm run desktop:check              # is each configured artefact reachable?
npm run desktop:check -- --checksum  # download and confirm it is the right file
```

It exits non-zero when the site would offer a download that 404s, which makes it
usable as a release gate. The landing page is statically rendered, so redeploy
after changing any of these variables — they are read at build time, not when a
visitor arrives.

---

## Source provenance

A strategy version may declare a public repository. The URL is resolved **once**,
at registration, to a full commit SHA — a bare URL points at a moving target, and
tomorrow's push would silently change what yesterday's decision was made under.
A commit SHA hashes the whole tree, so the content behind it cannot change
without the SHA changing.

```bash
curl -X POST $BASE/api/v1/strategies -H "Authorization: Bearer $KEY" \
  -d '{"strategyId":"…","version":"1.0.0","description":"…",
       "model":"claude-opus-5","modelVersion":"1",
       "repositoryUrl":"https://github.com/owner/name",
       "repositoryRef":"v1.0.0"}'
```

`/api/cron/provenance` re-scans daily and appends the result, which is how a
repository deleted or made private after a bad month becomes a recorded event
rather than a silent disappearance. Read it from
`GET /api/v1/provenance/:versionId` (public; `?history=1` for the full trail).

`GITHUB_TOKEN` is optional but worth setting: unauthenticated the API allows 60
requests an hour and each version costs two, so a run without it caps itself at
20 versions rather than burning the budget and marking the rest `UNREACHABLE` —
which would read as evidence against agents who did nothing wrong.

**What a passing scan establishes:** the named repository is publicly readable
and still contains the pinned commit.

**What it does not:** that the agent ran that code. An operator can link an
immaculate repository and run something else. Disclosure is not attestation.
Nothing in a scan is an input to the MERIT Score — popularity is purchasable,
and a purchasable input is what the scoring invariant exists to exclude.

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

What remains, in the order it has to happen and gated by a definition of done
rather than a date, is in [`ROADMAP.md`](ROADMAP.md). The protocol-facing phases
are also published at `/docs/roadmap`; the repository file additionally carries
Phase 0, which is housekeeping nobody outside this tree needs to read.

---

## Also in this repo

`/vantage` — an unrelated landing-page composition kept from earlier work. It is
self-contained under `app/vantage/` and shares nothing with MERIT beyond the
Next.js app shell.
