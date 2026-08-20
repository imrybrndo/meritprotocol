# Roadmap

**Proof first, then reputation, then capital.**

The order below is the protocol's own argument, applied to its own construction.
Each phase is a precondition for the next rather than a preference, and where
that is not obvious the phase says why it sits where it does.

Phases are gated by a definition of done, not by a date. A phase that cannot
state what would prove it finished is not ready to be started.

---

## Where the protocol stands

The **proof** and **reputation** layers are substantially complete: commitment
with canonical encoding and per-decision salt, Merkle batching, EVM anchoring
behind a chain-agnostic adapter, public seven-check verification, the MERIT
Score with confidence damping, six qualification tiers, an SDK that verifies
proofs without contacting us, and a non-custodial desktop console.

What does not exist is a way in. Registering an agent requires `agents:write`,
and the only credential that carries it is one issued by `npm run key:create` —
which requires shell access to the server. That is why Phase 1 is Phase 1.

| Phase | Focus | Done when |
| --- | --- | --- |
| 0 | Clean foundation | Tree is clean, one story about the chain, `npm run verify` green |
| 1 | The way in | A stranger reaches their first committed decision without our shell |
| 2 | Attribution | A decision is bound to a wallet signature, not only an API key |
| 3 | Coverage honesty | A profile shows what is *not* proven as clearly as what is |
| 4 | Distribution | Third parties build on MERIT without talking to us |
| 5 | Independence | Verification survives MERIT's API being down |
| 6 | Capital | The metric gates are passed — not a date reached |

---

## Phase 0 — A foundation that does not fork

Every phase after this one touches the schema and the API. Settle the base now,
while it is cheap.

- Commit the finished source-provenance work. `lib/provenance/`,
  `lib/services/provenance.ts`, its migration and `tests/provenance.test.ts`
  are complete and still uncommitted.
- Move `lib/generated/prisma/` into `.gitignore` and generate it at build time.
  The last diff carried 2,657 lines of regenerated client.
- Decide what happens to `app/vantage/`. It is unrelated to MERIT by its own
  README entry; keep it in its own repository or remove it.
- Tell one story about the chain. The working tree lives under `solana/` while
  the active adapter is EVM. The adapter is legitimately chain-agnostic; the
  documentation and the pitch cannot be.
- Write commit messages that can be read. A protocol whose argument is auditable
  history should not have a history of `Update`.

**Done when:** `npm run verify` is green, `git status` is clean, and no
directory needs to be explained to a newcomer.

**Why here:** this is not housekeeping. While generated artefacts are committed,
every review of Phases 1–3 is buried under thousands of lines nobody wrote.

---

## Phase 1 — The way in

The single thing standing between MERIT and having users, and closer than it
looks.

### What already exists

`POST /api/v1/auth/challenge` and `POST /api/v1/auth/wallet` already exchange a
signed challenge for an API key. The desktop console uses them today.

### The two gaps that keep the door shut

- The default scope set on `ApiKey` is `decisions:write, outcomes:write` — it
  does not include `agents:write`, and the wallet route does not override it.
  A wallet-issued key therefore cannot register an agent at all.
- There is no account surface on the web. The site is `agents`, `dashboard`,
  `docs`, `leaderboard` and `verify` — every one of them read-only.

### Build

- An account page: wallet sign-in on the web over the endpoints that already
  exist, the caller's own agents, and key management — issue and revoke, with
  the plaintext shown exactly once, as `generateApiKey` already guarantees.
- Agent registration from the interface. Decide one of two: a wallet-issued key
  carries `agents:write`, or registration runs over the session and never over
  an API key at all. The second is the safer default — an agent-writing
  credential that lives on an operator's machine is a larger blast radius than
  a decision-writing one.
- A "start here" page that hands over the first key alongside an SDK snippet
  already filled in with the agent ID that was just created.

**Done when:** someone we have never met can go from nothing to a first
committed decision without anyone touching a shell on the server.

**Why here:** Phases 2 through 5 all need real agents to be tested against.
Exercising attribution and coverage on five seeded demo agents only proves the
seed script works.

---

## Phase 2 — Signed agent actions

Bind the record to an identity rather than to a credential that can change hands.

- A signing key on `Agent`; a decision carries a signature over the canonical
  encoding that already exists in `lib/crypto/`.
- Verification grows from seven checks to eight — *signed by a registered agent
  key* — reported separately like every other check, and `SKIPPED` for records
  written before the field existed.
- The signature enters the proof bundle and `verifyProofOffline` in
  `packages/sdk`.

**Done when:** the proof bundle carries the signature, the SDK verifies it
offline, and a cross-check test fails the build if the two implementations ever
disagree — exactly as the suite already does for Merkle trees of 1 to 129
leaves.

**Why here:** today a decision is bound only to an API key, and an API key can
be lent. Before a reputation means anything outside MERIT, the record has to
point at an identity its owner could be confronted with.

---

## Phase 3 — Coverage honesty

The largest hole in the thesis is selective registration: an agent that only
registers the trades it won. It is measured rather than assumed, which is
correct, but it is currently measured somewhere nobody looks.

- Raise proof coverage, cadence and abstention from score components to
  surfaces: a badge on the agent profile, a column on the leaderboard.
- A "what is not proven" panel on the profile, alongside the provenance panel.
- The large optional step: venue attestation through a read-only exchange API,
  which is what turns disclosure into evidence.

**Done when:** a visitor can read the limits of an agent's claim from its
profile, without opening `/docs/security`.

**Why here:** this decides whether a MERIT figure means *the record is intact*
or *the performance is intact*. The distance between those two sentences is
exactly what the first allocator will ask about, and today the answer lives only
in the FAQ.

---

## Phase 4 — Distribution

Make a MERIT reputation usable somewhere that is not our own site.

- Webhooks for anchor confirmation and tier changes.
- An embeddable badge, and a public agent page worth sharing as it is.
- An auto-update channel for the console, replacing manual GitHub releases.
  Make `npm run desktop:check` a release gate in CI — it already exits non-zero
  when the site would offer a download that 404s.

**Done when:** a third party can display and react to MERIT reputation without
ever talking to us.

**Why here:** distributing before Phase 3 means spreading numbers whose limits
are unreadable. After Phase 3, the same numbers explain themselves.

---

## Phase 5 — Independence from MERIT

Close the gap between the claim and the practice on this protocol's largest
promise.

- An independent verifier that publishes its own results.
- Further chain adapters behind the existing interface.

**Done when:** a third-party verifier publishes results matching ours for the
same batch, and can still do so while our API is down.

**Why here:** "verify without trusting MERIT" is already true cryptographically —
the proof bundle is genuinely self-contained — but in practice it still runs
through our uptime. This phase makes the sentence true without qualification.

---

## Phase 6 — Capital network

Allocation against verified reputation, non-custodial. Deliberately last, and
gated by measurement rather than by a date.

**Entry conditions:**

- A number of real — not demo — agents with at least 180 days of operating
  history, enough to clear confidence damping without help.
- Median proof coverage above a threshold fixed *before* looking at the data.
- At least one independent verifier live from Phase 5.

**Done when:** all three gates are passed. Until then this phase does not start,
and that is a decision rather than a delay.

**Why here:** allocating capital against a reputation system that has not been
stress-tested would invert the order this protocol argues for.

---

## Three decisions that hold up the rest

All three can be answered this week, and all three change the shape of Phase 1.

1. **Which chain is final.** The adapter is genuinely agnostic; the directory
   name, the README and the pitch cannot be.
2. **The first ten operators.** Who they are, and whether they arrive through
   the console or the SDK. Phase 1 is built differently depending on the answer.
3. **Where the revenue comes from.** No token and no fee is a legitimate answer
   for now, as long as it is a decision that was taken rather than a question
   that was avoided.

---

## Not on this roadmap, in any phase

These limits are documented and enforced by tests rather than by intention, and
nothing here changes them.

- A token balance raising a reputation score.
- A payment raising a qualification tier.
- Custody of user funds, in any form.
- Order routing. MERIT records decisions; it does not execute them.
