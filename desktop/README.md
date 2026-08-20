# MERIT Console

A desktop workspace for operating a MERIT agent. Chat with an agent about a
call, seal the call as a commitment, then execute it yourself — in that order.

## What it is, and what it deliberately is not

This is the **client side of the protocol**, not a trading terminal. The
distinction is the ordering:

```
propose → commit to MERIT → operator executes → reveal outcome
```

A terminal executes and logs afterwards. A record written after the outcome is
known proves nothing, so the console commits first and never executes at all.
Execution happens in the operator's own wallet, on their own venue.

Three consequences follow, and they are load-bearing rather than incidental:

- **No custody.** The console holds no keys that can move funds, per §31 of the
  protocol spec. It cannot sign a transaction.
- **No database access.** It talks to `/api/v1` over HTTP like any third-party
  client. Shipping `DATABASE_URL` to end-user machines would hand every operator
  write access to the entire protocol.
- **No invented data.** With no venue adapter connected, the perps and liquidity
  panels report that fact and show nothing, rather than displaying placeholder
  positions. See `src/main/venues.ts`.

## Security model

The renderer is treated as untrusted web content: sandboxed, context-isolated,
no Node integration, and a strict CSP that blocks it from making network
requests of its own.

Credentials never cross the bridge. They are encrypted at rest with the OS
keyring via Electron's `safeStorage` and held in the main process; the renderer
asks for an authenticated call to be *made* and receives the result. A
compromised window can therefore issue the calls the bridge already exposes, but
cannot read a key or exfiltrate one. Where no keyring is available, the vault
refuses to write rather than falling back to plaintext.

The IPC surface in `src/main/preload.ts` is enumerated explicitly — there is no
generic `invoke(channel, …)` escape hatch, which is the usual way a
context-isolated app leaks its privileges back to the page.

## Setup

```bash
npm install
npm start
```

Then open **Settings** and provide:

| Field | Where it comes from |
|---|---|
| MERIT endpoint | Your deployment. Defaults to `http://localhost:3000`. |
| MERIT API key | `npm run key:create -- --email you@example.com` in the repo root. |

The chat agent's own key sits under **Chat agent**, and the identical controls
are mounted in the **Chat** panel behind the model chip in its header — one
implementation, reachable from wherever you happen to be when you need it.
Either provider works —

| Provider | What it needs |
|---|---|
| Anthropic | A key from `console.anthropic.com`. The model is pinned to `claude-opus-5`. |
| OpenRouter | A key from `openrouter.ai/keys`, plus a model from the catalogue. Only tool-capable models are listed: an agent that cannot call `commit_decision` cannot do this job. |

Chat is optional — every other panel works without a model connected.

## Packaging a macOS build

```bash
npm run dist:mac          # both architectures
npm run dist:mac:arm64    # Apple Silicon only
```

electron-builder writes `release/MERIT-<version>-<arch>.dmg` — the
`artifactName` pattern in `package.json`. The bundle is what esbuild already
produced — `dist/**` and `package.json`, nothing from `node_modules`, because
every dependency is inlined at build time.

That name matters beyond the local file: the landing page derives its download
URLs from the same pattern (`dmgFilename` in `lib/desktop.ts`). Change
`artifactName` and you must change that function too, or the site will render a
button that 404s.

Signing is not configured here on purpose. With no Developer ID in the keychain
the image still builds and still installs, but Gatekeeper will quarantine it on
another machine; that is honest for an unsigned artefact. To ship a signed and
notarised one, set `CSC_LINK`/`CSC_KEY_PASSWORD` and the notarisation
credentials in the environment — `hardenedRuntime` is already on, which
notarisation requires.

## Publishing the build

A `.dmg` is ~125 MB per architecture. It is not committed (`desktop/.gitignore`
excludes `release/`) and not deployed (`.vercelignore` excludes `desktop/` and
`public/downloads/`), because a quarter-gigabyte of binaries has no business in
a Git history or in a web deployment — and Vercel would reject them anyway.
They are hosted as release assets instead.

```bash
# from the repository root, after `npm run dist:mac`
gh release create v0.1.0 \
  desktop/release/MERIT-0.1.0-arm64.dmg \
  desktop/release/MERIT-0.1.0-x64.dmg \
  --title "MERIT Console 0.1.0" \
  --notes "Unsigned macOS build. See the download section for the checksums."
```

Then set `MERIT_DESKTOP_RELEASE_TAG=v0.1.0` in the deployment environment. Both
architecture URLs are derived from the tag and the `artifactName` pattern, so
that single variable is what turns the download section on; the per-architecture
`MERIT_DESKTOP_MAC_*_URL` overrides exist for assets hosted elsewhere. Publish
the checksums alongside them —

```bash
shasum -a 256 desktop/release/*.dmg
```

— into `MERIT_DESKTOP_MAC_ARM64_SHA256` and its x64 twin. Without them the site
still offers the download; with them a visitor can check what they got against
what was published, which is the whole argument this project makes about
everything else.

Until a tag is configured the landing page refuses to render a button at all
and shows the build-from-source instructions instead, rather than linking a disk
image that does not exist. One deployment gotcha: the landing page is statically
rendered, so these variables are read at build time. Setting them in the Vercel
dashboard does nothing until you redeploy.

Because the build is unsigned, macOS will refuse it on first open with "cannot
be opened because the developer cannot be verified". Right-click the app and
choose Open, or `xattr -dr com.apple.quarantine /Applications/MERIT.app`. That
friction is the accurate signal for an unsigned artefact, and it goes away only
with a Developer ID and notarisation.

## Panels

- **Chat** — the operator agent, on Anthropic or on any tool-capable OpenRouter
  model. It can read agents and open decisions, and it can seal a decision.
  Every commit is gated on explicit approval; the model proposes, a person
  decides, the protocol records. The model chip in the header configures the
  key and the model without leaving the panel; the same controls live in
  Settings. The key itself is held by the main process and never reaches the
  window.
- **Agents** — agents registered on the deployment.
- **Perps** — live Phoenix perpetual-futures market data: 65 markets across
  crypto and equities, candlesticks with a volume pane, orderbook, and whatever
  MERIT has committed on the same asset. Read-only; the console never places an
  order, because doing so would mean holding a signing key.
- **RWA** — tokenized real-world assets: treasuries, private credit and gold,
  read live from Ethereum. Supply comes from each token contract and the gold
  price from a Chainlink feed, so every figure is an `eth_call` an operator can
  repeat — each screen names the block it was read at. Instruments whose NAV is
  published off chain show a supply and no dollar value, deliberately. Any
  instrument can be handed to Chat to think through and seal a commitment on.
- **Liquidity** — venue-reported LP positions. Empty until an adapter exists.
- **Settings** — account, recovery, and the chat agent's provider, key and
  model.

## Real-world assets

The RWA panel holds a registry of eleven instruments in `src/main/rwa.ts`, each
verified against its own contract before it was added — the symbol the chain
reports is re-checked on every refresh, and a mismatch blanks that row rather
than showing numbers under the wrong name.

What can be valued is decided per instrument, not per row of the table:

| Denomination | Value shown | Instruments |
|---|---|---|
| `usd-par` | Supply, which is the dollar figure — the unit is held at $1 by construction | BUIDL, STBT, USDM |
| `ounce` | Supply × Chainlink XAU/USD, one fine troy ounce per token | PAXG, XAUT |
| `share` | None. The NAV moves and is published off chain | USDY, OUSG, USTB, TBILL, bIB01, FIDU |

The empty column is the point. A console arguing that a record is worth only its
provenance cannot print an AUM it took from a press release.

Issuer logos come from CoinGecko's Ethereum token list — one request, keyed by
contract address rather than by ticker so a mark cannot be attached to the wrong
token by a symbol collision. Nine of the eleven are in it; the other two fall
back to a monogram tinted by asset class. Artwork is fetched in the main process
and handed over as data URIs, because the renderer's CSP grants it no network of
its own; the size cap and `image/*` check that make that safe live in
`src/main/logos.ts`, shared with the market panel.

Reads go to the same public endpoints the wallet balance check uses
(`ethereum-rpc.publicnode.com`, falling back to `1rpc.io`), need no key, and are
cached for a minute so navigating between panels does not re-read eleven
contracts. The chat agent reaches the same snapshot through its
`list_rwa_assets` tool, so what it cites and what the panel shows cannot differ.

## Market data

The Perps panel reads Phoenix's public API (`perp-api.phoenix.trade`) — no key,
no wallet. Market logos are fetched in the main process and handed to the
renderer as `data:` URIs: the renderer's CSP blocks it from making network
requests of its own, and third-party SVG is only safe because an `<img>` loads
it in secure static mode, with scripts and external references disabled.

The chart is built on TradingView's **Lightweight Charts** (Apache-2.0), bundled
locally — nothing is fetched at runtime, which the renderer's CSP would refuse
anyway. It brings drag-to-pan, scroll-to-zoom, and auto-scaling. The other
"TradingView SDK", Advanced Charts, is a different product needing a separate
licence agreement and a datafeed adapter, and is far heavier than this panel
warrants. TradingView's attribution logo on the chart is a licence obligation,
not decoration — leave it in place.

The library injects one inline stylesheet, which the CSP allows by **sha256
hash** rather than by opening `style-src` to `'unsafe-inline'`. If a library
upgrade changes that sheet, the renderer console reports the new hash to use.

The accessibility choices are configuration, not defaults. Candles are blue for
up and red for down rather than the conventional green/red.
Green and red separate by ΔE 2.2 under deuteranopia — a red-green reader cannot
tell them apart at all — while blue and red separate by 26.6. Direction is also
carried by geometry (up candles hollow, down filled), so the chart survives
greyscale and print. Volume sits in its own **pane** (not an overlay on a second
price scale) sharing the x-axis — two scales on one plot invent a correlation
that is not in the data.

## Connecting a venue

`VenueAdapter` in `src/main/venues.ts` is the seam, modelled on the protocol's
`AnchorService`: implement the interface, call `setVenueAdapter()`, and the
perps and liquidity panels populate. The shipped adapter is the disconnected
one, which is honest about returning nothing.
