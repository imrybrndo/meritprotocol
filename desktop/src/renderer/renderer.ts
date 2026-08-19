/**
 * Renderer.
 *
 * Holds no credentials and speaks to nothing over the network. Every
 * privileged action goes through the `window.merit` bridge defined in
 * preload.ts, so the worst a compromised page can do is make the calls the
 * bridge already exposes.
 */

import { formatCompact, formatPrice, renderChart, type Candle, type ChartHandle } from "./chart";
import { hydrateIcons, icon, type IconName } from "./icons";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

interface Session { prefix: string; label: string; scopes: string[] }
interface WalletStatus {
  exists: boolean; unlocked: boolean; address: string | null;
  /** Written by the Solana build: openable by nothing this build can derive. */
  legacy: boolean;
}
interface Account { id: string; walletAddress: string; createdAt: string }

/**
 * What the window should open as. `signedIn` with a null session means the
 * credential is held but the deployment could not be reached to confirm it.
 */
type AuthState =
  | {
      signedIn: true;
      session: Session | null;
      status: VaultStatus;
      wallet: WalletStatus;
      offline?: string;
    }
  | { signedIn: false; status: VaultStatus; wallet: WalletStatus; rejected?: string };

interface Bridge {
  vault: {
    status(): Promise<Result<VaultStatus>>;
    setSecret(name: string, value: string): Promise<Result<VaultStatus>>;
    clearSecret(name: string): Promise<Result<VaultStatus>>;
    setBaseUrl(url: string): Promise<Result<VaultStatus>>;
  };
  wallet: {
    status(): Promise<Result<WalletStatus>>;
    balance(): Promise<Result<{ address: string; eth: number }>>;
    /** The phrase is returned exactly once, for the operator to write down. */
    create(passphrase: string, replace?: boolean): Promise<Result<{ mnemonic: string; address: string }>>;
    import(mnemonic: string, passphrase: string): Promise<Result<{ address: string }>>;
    importKey(secret: string, passphrase: string): Promise<Result<{ address: string }>>;
    unlock(passphrase: string): Promise<Result<{ address: string }>>;
    reveal(passphrase: string): Promise<Result<string>>;
    revealKey(passphrase: string): Promise<Result<string>>;
    forget(): Promise<Result<WalletStatus>>;
  };
  trade: {
    account(): Promise<Result<TradeAccount>>;
    funding(): Promise<Result<FundingState>>;
    deposit(amount: number): Promise<Result<{ hash: string; amount: number; explorer: string }>>;
    verifySigning(): Promise<Result<{ result: string; detail: string }>>;
    leverage(symbol: string, leverage: number): Promise<Result<void>>;
    agents(): Promise<Result<{ total: number; agents: Agent[] }>>;
    place(input: {
      symbol: string; side: "long" | "short"; size: number; limitPrice?: number;
      agentId: string; confidence: string; rationale: string;
    }): Promise<Result<{ commitment: unknown; receipt: TradeReceipt }>>;
  };
  agent: {
    config(patch?: Partial<AgentConfig>): Promise<Result<AgentConfig>>;
    models(): Promise<Result<OpenRouterModel[]>>;
  };
  auth: {
    state(): Promise<Result<AuthState>>;
    signIn(
      baseUrl: string,
    ): Promise<
      Result<{ session: Session; account: Account; status: VaultStatus; wallet: WalletStatus }>
    >;
    signOut(): Promise<Result<{ status: VaultStatus; wallet: WalletStatus }>>;
  };
  protocol: {
    health(): Promise<Result<{ reachable: boolean; agents: number | null }>>;
    agents(): Promise<Result<{ total: number; agents: Agent[] }>>;
    decisions(query: { agentId?: string; status?: string }): Promise<Result<Decision[]>>;
  };
  venues: { positions(): Promise<Result<VenueState>> };
  market: {
    list(): Promise<Result<MarketRow[]>>;
    overview(): Promise<Result<MarketPulse[]>>;
    candles(symbol: string, timeframe: string): Promise<Result<Candle[]>>;
    logos(): Promise<Result<Record<string, string>>>;
    book(symbol: string): Promise<Result<{ bids: Array<[number, number]>; asks: Array<[number, number]> }>>;
    snapshot(symbol: string, timeframe: string): Promise<Result<MarketSnapshot>>;
  };
  chat: {
    send(text: string): Promise<Result<boolean>>;
    reset(): Promise<Result<boolean>>;
    approve(id: string, approved: boolean): Promise<Result<boolean>>;
    onText(fn: (delta: string) => void): () => void;
    onTool(fn: (name: string) => void): () => void;
    onApproval(fn: (request: Approval) => void): () => void;
    onApprovalSettled(fn: (id: string) => void): () => void;
  };
}

interface AgentConfig { provider: "anthropic" | "openrouter"; openrouterModel: string }
interface TradePosition {
  symbol: string; size: number; entryPrice: number | null;
  positionValue: number; unrealizedPnl: number;
  leverage: number | null; liquidationPrice: number | null;
}
interface TradeAccount {
  address: string; accountValue: number; withdrawable: number;
  marginUsed: number; funded: boolean; positions: TradePosition[];
}
interface FundingState {
  address: string; usdc: number; usdcE: number; gas: number;
  minimum: number; canDeposit: boolean; bridge: string;
  network: { name: string; chainId: number };
  token: { symbol: string; address: string; decimals: number };
  qr: string;
}
interface TradeReceipt {
  status: "filled" | "resting" | "unknown";
  price: number | null; size: number | null; orderId: number | null;
}
interface OpenRouterModel {
  id: string; name: string; contextLength: number | null;
  promptPrice: number | null; completionPrice: number | null;
}

interface VaultStatus {
  encryptionAvailable: boolean;
  meritApiKey: boolean;
  anthropicApiKey: boolean;
  openrouterApiKey: boolean;
  meritBaseUrl: string;
  agent: AgentConfig;
}
interface Agent {
  id: string; slug: string; name: string; status: string;
  verificationStatus: string; riskProfile: string; chain: string;
  assets: string[]; isDemo: boolean;
}
interface Decision {
  id: string; agentId: string; asset: string; action: string;
  price: string; quantity: string; confidence: string; status: string;
  commitmentHash: string; committedAt: string; isDemo: boolean;
}
interface VenueState {
  name: string; connected: boolean;
  perps: Array<Record<string, string | null>>;
  lp: Array<Record<string, string | boolean>>;
}
interface Approval { id: string; summary: string; input: Record<string, unknown> }
interface MarketRow {
  symbol: string; name: string; openInterest: number;
  maxLeverage: number; description: string | null;
}
interface MarketPulse {
  symbol: string; name: string;
  price: number | null; change24h: number | null;
  volumeQuote: number | null; openInterest: number; spark: number[];
}
interface MarketSnapshot {
  symbol: string; name: string;
  maxLeverage: number;
  description: string | null;
  markPrice: number | null; spotPrice: number | null;
  openInterest: number | null; fundingRate: number | null; volumeQuote: number;
  candles: Candle[];
  bids: Array<[number, number]>; asks: Array<[number, number]>;
  degraded: string[];
}

declare global { interface Window { merit: Bridge } }
const api = window.merit;

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const el = (tag: string, cls?: string, text?: string) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
};

/** Build a <thead> row. Element.append() returns void, so it cannot be chained. */
function headerRow(table: HTMLElement, labels: string[]): void {
  const head = el("tr");
  labels.forEach((label) => head.append(el("th", undefined, label)));
  const thead = el("thead");
  thead.append(head);
  table.append(thead);
}

/**
 * A badge. Optional leading glyph, matching the site's <Badge>: a check for a
 * settled-good state, a dash for one that is merely unknown.
 */
function tag(cls: string, text: string, glyph?: IconName): HTMLElement {
  const node = el("span", cls, text);
  if (glyph) node.prepend(icon(glyph, 11));
  return node;
}

/** A <td> wrapping a single element. */
function cell(child: HTMLElement): HTMLElement {
  const td = el("td");
  td.append(child);
  return td;
}

/* ------------------------------------------------------------ navigation -- */

const panels = new Map<string, HTMLElement>();
document.querySelectorAll<HTMLElement>(".panel").forEach((p) => panels.set(p.dataset.panel!, p));

function show(name: string): void {
  if (name !== "perps") stopBookPoll();

  document.querySelectorAll(".nav-item").forEach((b) =>
    b.classList.toggle("is-active", (b as HTMLElement).dataset.panel === name),
  );
  panels.forEach((panel, key) => panel.classList.toggle("is-active", key === name));

  if (name === "dashboard") void loadDashboard();
  if (name === "agents") void loadAgents();
  if (name === "perps") void loadPerps();
  if (name === "lp") void loadLp();
  if (name === "settings") void loadSettings();
}

$("#nav").addEventListener("click", (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>(".nav-item");
  if (target?.dataset.panel) show(target.dataset.panel);
});

/* ---------------------------------------------------------------- health -- */

async function refreshHealth(): Promise<void> {
  const dot = $("#health-dot");
  const text = $("#health-text");
  const result = await api.protocol.health();

  const up = result.ok && result.data.reachable;
  dot.classList.toggle("is-up", up);
  dot.classList.toggle("is-down", !up);
  text.textContent = up
    ? `protocol · ${result.ok ? result.data.agents : 0} agents`
    : "protocol unreachable";
}

/* ------------------------------------------------------------- dashboard -- */

/**
 * A sparkline as an inline SVG path. Drawn rather than charted: twenty-four
 * points do not need an axis, a tooltip, or a charting library.
 */
function sparkline(values: number[], up: boolean): SVGSVGElement {
  const width = 84;
  const height = 30;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("class", "dash-spark");
  svg.setAttribute("aria-hidden", "true");
  if (values.length < 2) return svg;

  const low = Math.min(...values);
  const high = Math.max(...values);
  const span = high - low || 1;
  const step = width / (values.length - 1);
  const points = values.map((value, index) => {
    const y = height - 3 - ((value - low) / span) * (height - 6);
    return `${(index * step).toFixed(2)},${y.toFixed(2)}`;
  });

  const colour = up ? "var(--profit)" : "var(--loss)";
  const area = document.createElementNS("http://www.w3.org/2000/svg", "path");
  area.setAttribute("d", `M0,${height} L${points.join(" L")} L${width},${height} Z`);
  area.setAttribute("fill", colour);
  area.setAttribute("opacity", "0.12");

  const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
  line.setAttribute("d", `M${points.join(" L")}`);
  line.setAttribute("fill", "none");
  line.setAttribute("stroke", colour);
  line.setAttribute("stroke-width", "1.5");
  line.setAttribute("stroke-linejoin", "round");
  line.setAttribute("stroke-linecap", "round");

  svg.append(area, line);
  return svg;
}

function percent(value: number | null): HTMLElement {
  if (value === null) return el("span", "delta", "—");
  const up = value >= 0;
  const node = el("span", `delta is-${up ? "up" : "down"}`);
  node.append(icon(up ? "rise" : "fall", 11));
  node.append(el("span", undefined, `${up ? "+" : ""}${(value * 100).toFixed(2)}%`));
  return node;
}

function usd(value: number | null, decimals = 2): string {
  if (value === null) return "—";
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

/** Card scaffold: heading row, then whatever the card is. */
function card(className: string, heading: string, glyph: IconName, extra?: HTMLElement): HTMLElement {
  const node = el("section", `glass ${className}`);
  const head = el("div", "dash-card-head");
  head.append(icon(glyph, 13), el("span", undefined, heading));
  if (extra) {
    extra.classList.add("spacer");
    head.append(extra);
  }
  node.append(head);
  return node;
}

let dashboardChart: ChartHandle | null = null;
let dashboardSymbol = "ETH";
let dashboardTab: "all" | "gainers" | "losers" | "traded" = "all";
let pulse: MarketPulse[] = [];

async function loadDashboard(): Promise<void> {
  // The panel is the default one, so boot marks it active before sign-in. There
  // is nothing to show behind the gate, and the fetch would be thrown away.
  if (shell.hidden) return;

  const body = $("#dashboard-body");
  if (body.childElementCount === 0) body.append(el("div", "empty", "Loading markets…"));

  // Every source is independent: a slow RPC must not hold up the market grid.
  const [balance, overview, decisions] = await Promise.all([
    api.wallet.balance(),
    api.market.overview(),
    api.protocol.decisions({}),
  ]);

  await loadLogos();
  pulse = overview.ok ? overview.data : [];

  const greet = el("div", "dash-greet");
  greet.append(el("h1", undefined, `Hello, ${currentAddress ? shortAddress(currentAddress) : "operator"}`));
  greet.append(
    el(
      "p",
      undefined,
      "Live Hyperliquid markets, and every decision you have sealed on MERIT. Nothing here is a projection.",
    ),
  );

  const grid = el("div", "dash-grid");
  grid.append(balanceCard(balance.ok ? balance.data : null, balance.ok ? null : balance.error));
  grid.append(tilesCard());
  grid.append(chartCard());
  grid.append(activityCard(decisions.ok ? decisions.data : [], decisions.ok ? null : decisions.error));
  grid.append(marketCard());

  body.replaceChildren(greet, grid);
  void drawDashboardChart();
}

/** The market the wallet balance is denominated in. */
const NATIVE = "ETH";

function nativeMarket(): MarketPulse | undefined {
  return pulse.find((market) => market.symbol === NATIVE);
}

function balanceCard(data: { address: string; eth: number } | null, error: string | null): HTMLElement {
  const node = card("dash-balance", "Wallet balance", "wallet");
  const price = nativeMarket()?.price ?? null;

  const amount = el("div", "dash-amount");
  if (data && price !== null) {
    const [whole, cents] = usd(data.eth * price).split(".");
    amount.append(el("span", undefined, whole), el("small", undefined, `.${cents}`));
  } else if (data) {
    amount.append(el("span", undefined, `${data.eth.toFixed(4)} ${NATIVE}`));
  } else {
    amount.append(el("span", undefined, "—"));
  }
  node.append(amount);

  node.append(el("div", "dash-sub", error ?? (data ? `${data.eth.toFixed(4)} ${NATIVE}` : "")));

  // The two facts the number above depends on: what SOL is worth, and which
  // address was actually read. Both were already fetched for this render.
  const meta = el("div", "dash-meta");

  const priceCell = el("div");
  priceCell.append(el("dt", undefined, `${NATIVE} price`));
  const priceValue = el("dd");
  priceValue.append(
    el("span", undefined, price === null ? "—" : formatPrice(price)),
    percent(nativeMarket()?.change24h ?? null),
  );
  priceCell.append(priceValue);

  const addressCell = el("div");
  addressCell.append(el("dt", undefined, "Address"));
  addressCell.append(el("dd", "mono", data ? shortAddress(data.address) : "—"));

  meta.append(priceCell, addressCell);
  node.append(meta);

  const actions = el("div", "dash-actions");
  const receive = el("button", "is-primary") as HTMLButtonElement;
  receive.append(icon("copy", 14), el("span", undefined, "Copy address"));
  receive.addEventListener("click", async () => {
    if (!data) return;
    await navigator.clipboard.writeText(data.address).catch(() => undefined);
    receive.replaceChildren(icon("check", 14), el("span", undefined, "Copied"));
    setTimeout(
      () => receive.replaceChildren(icon("copy", 14), el("span", undefined, "Copy address")),
      1600,
    );
  });

  const explorer = el("button") as HTMLButtonElement;
  explorer.append(icon("external", 14), el("span", undefined, "Explorer"));
  explorer.addEventListener("click", () => {
    if (data) window.open(`https://etherscan.io/address/${data.address}`, "_blank");
  });

  actions.append(receive, explorer);
  node.append(actions);
  return node;
}

function tilesCard(): HTMLElement {
  const wrap = el("div", "dash-tiles");

  pulse.slice(0, 4).forEach((market) => {
    const tile = el("button", "glass dash-tile") as HTMLButtonElement;
    tile.append(logoFor(market.symbol));

    const name = el("div", "dash-tile-name");
    name.append(el("b", undefined, market.symbol));
    if (market.name && market.name !== market.symbol) {
      name.append(el("span", undefined, market.name));
    }
    tile.append(name);

    tile.append(sparkline(market.spark, (market.change24h ?? 0) >= 0));

    const figure = el("div", "dash-tile-figure");
    figure.append(el("b", undefined, market.price === null ? "—" : formatPrice(market.price)));
    figure.append(percent(market.change24h));
    tile.append(figure);

    tile.addEventListener("click", () => {
      dashboardSymbol = market.symbol;
      void loadDashboard();
    });
    wrap.append(tile);
  });

  return wrap;
}

function chartCard(): HTMLElement {
  const node = el("section", "glass dash-chart");
  const market = pulse.find((row) => row.symbol === dashboardSymbol);

  const head = el("div", "dash-chart-head");
  head.append(logoFor(dashboardSymbol));
  head.append(el("h2", undefined, `${dashboardSymbol} · ${dashboardTimeframe} candles`));

  const tabs = el("div", "dash-tabs");
  (["5m", "15m", "1h", "4h", "1d"] as const).forEach((frame) => {
    const button = el("button", frame === dashboardTimeframe ? "is-active" : "", frame);
    button.addEventListener("click", () => {
      dashboardTimeframe = frame;
      void loadDashboard();
    });
    tabs.append(button);
  });
  tabs.classList.add("spacer");
  head.append(tabs);
  node.append(head);

  const price = el("div", "dash-price");
  price.append(
    el("span", undefined, market?.price == null ? "—" : formatPrice(market.price)),
    percent(market?.change24h ?? null),
  );
  node.append(price);

  const holder = el("div", "chart");
  holder.id = "dash-chart";
  node.append(holder);
  return node;
}

let dashboardTimeframe: "5m" | "15m" | "1h" | "4h" | "1d" = "1h";

async function drawDashboardChart(): Promise<void> {
  const holder = document.querySelector<HTMLElement>("#dash-chart");
  if (!holder) return;

  const result = await api.market.candles(dashboardSymbol, dashboardTimeframe);
  dashboardChart?.destroy();
  if (!result.ok) {
    holder.replaceChildren(el("p", "chart-empty", result.error));
    return;
  }
  dashboardChart = renderChart(holder, result.data, {
    timeframe: dashboardTimeframe,
    // The dashboard chart is a glance, not a workspace: no crosshair readout to
    // feed, so hovering changes nothing.
    onHover: () => {},
  });
}

function activityCard(decisions: Decision[], error: string | null): HTMLElement {
  const node = card("dash-activity", "Sealed decisions", "seal");
  const rows = el("div", "rows");

  if (error) {
    rows.append(el("p", "chart-empty", error));
  } else if (decisions.length === 0) {
    rows.append(
      el("p", "chart-empty", "Nothing committed yet. Seal a call from Chat and it appears here."),
    );
  }

  decisions.slice(0, 8).forEach((decision) => {
    const buy = decision.action === "BUY" || decision.action === "COVER";
    const row = el("div", `act-row is-${buy ? "buy" : "sell"}`);

    const mark = el("div", "act-mark");
    mark.append(icon(buy ? "rise" : "fall", 13));
    row.append(mark);

    const meta = el("div", "act-meta");
    meta.append(el("b", undefined, `${decision.action} ${decision.asset}`));
    meta.append(
      el("span", undefined, new Date(decision.committedAt).toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
      })),
    );
    row.append(meta);

    const figure = el("div", "act-figure");
    figure.append(el("b", undefined, usd(Number(decision.price))));
    figure.append(el("span", undefined, `${decision.quantity} ${decision.asset}`));
    row.append(figure);

    rows.append(row);
  });

  node.append(rows);
  return node;
}

function marketCard(): HTMLElement {
  const tabs = el("div", "dash-tabs");
  const labels: Array<[typeof dashboardTab, string]> = [
    ["all", "Overview"],
    ["gainers", "Top gainers"],
    ["losers", "Top losers"],
    ["traded", "Most traded"],
  ];
  labels.forEach(([key, label]) => {
    const button = el("button", key === dashboardTab ? "is-active" : "", label);
    button.addEventListener("click", () => {
      dashboardTab = key;
      void loadDashboard();
    });
    tabs.append(button);
  });

  const node = card("dash-market", "Market overview", "perps", tabs);

  const rows = pulse
    .slice()
    .sort((a, b) => {
      if (dashboardTab === "gainers") return (b.change24h ?? -Infinity) - (a.change24h ?? -Infinity);
      if (dashboardTab === "losers") return (a.change24h ?? Infinity) - (b.change24h ?? Infinity);
      if (dashboardTab === "traded") return (b.volumeQuote ?? 0) - (a.volumeQuote ?? 0);
      // Open interest in base units favours cheap assets; rank on notional.
      return (b.price ?? 0) * b.openInterest - (a.price ?? 0) * a.openInterest;
    })
    .slice(0, 8);

  const table = el("table");
  headerRow(table, ["Asset", "Price", "24h", "24h volume", "Open interest", "Trend"]);

  const tbody = el("tbody");
  rows.forEach((market) => {
    const row = el("tr");

    const asset = el("div", "asset-cell");
    asset.append(logoFor(market.symbol));
    const naming = el("div");
    naming.append(el("b", undefined, market.symbol));
    if (market.name && market.name !== market.symbol) {
      naming.append(el("span", undefined, ` ${market.name}`));
    }
    asset.append(naming);
    row.append(cell(asset));

    row.append(el("td", "num", market.price === null ? "—" : formatPrice(market.price)));
    row.append(cell(percent(market.change24h)));
    row.append(
      el("td", "num", market.volumeQuote === null ? "—" : `$${formatCompact(market.volumeQuote)}`),
    );
    row.append(el("td", "num", formatCompact(market.openInterest)));

    const trend = el("td");
    trend.append(sparkline(market.spark, (market.change24h ?? 0) >= 0));
    row.append(trend);

    tbody.append(row);
  });

  table.append(tbody);
  node.append(table);
  return node;
}

/* ----------------------------------------------------------------- sheet -- */

/**
 * Re-authentication for exporting a secret.
 *
 * The password is asked for every single time, and never held: an unlocked
 * console is not standing consent to export the key. What comes back is put on
 * screen, blurred until asked for, and torn out of the DOM when the sheet
 * closes — a secret left in a detached node is still a secret in the page.
 */
const sheet = $("#sheet");
let sheetTimer: number | undefined;
let sheetSecret = "";

function closeSheet(): void {
  sheet.hidden = true;
  window.clearInterval(sheetTimer);

  // Every trace, not just the visible one.
  sheetSecret = "";
  $("#sheet-secret").replaceChildren();
  $<HTMLInputElement>("#sheet-pass").value = "";
  $("#sheet-timer").textContent = "";
  $("#sheet-note").hidden = true;
}

/** Twelve words, in the same grid the backup screen used. */
function phraseGrid(phrase: string): HTMLElement {
  const grid = el("div", "phrase");
  phrase.split(/\s+/).forEach((word, index) => {
    const cell = el("span");
    cell.append(el("b", undefined, String(index + 1)), el("span", undefined, word));
    grid.append(cell);
  });
  return grid;
}

function openSheet(kind: "phrase" | "key"): void {
  const phrase = kind === "phrase";
  closeSheet();
  sheet.hidden = false;

  $("#sheet-title").textContent = phrase ? "Reveal your seed phrase" : "Reveal your private key";
  $("#sheet-warn").querySelector("span")!.textContent = phrase
    ? "Anyone with these twelve words owns this account. Never type them into a site, a chat, or a support ticket — MERIT will never ask for them."
    : "This key signs as you. Anyone who reads it can move anything the wallet holds, on any chain.";

  $("#sheet-form").hidden = false;
  $("#sheet-reveal").hidden = true;
  $<HTMLInputElement>("#sheet-pass").focus();

  const submit = $<HTMLButtonElement>("#sheet-submit");
  submit.dataset.kind = kind;
  setBusy(submit, false, "Reveal");
}

$("#sheet-cancel").addEventListener("click", closeSheet);
$("#sheet-done").addEventListener("click", closeSheet);
sheet.addEventListener("click", (event) => {
  if (event.target === sheet) closeSheet();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !sheet.hidden) closeSheet();
});

$("#sheet-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("#sheet-note").hidden = true;

  const submit = $<HTMLButtonElement>("#sheet-submit");
  const kind = submit.dataset.kind as "phrase" | "key";
  const password = $<HTMLInputElement>("#sheet-pass").value;

  setBusy(submit, true, "Reveal");
  const result = kind === "phrase"
    ? await api.wallet.reveal(password)
    : await api.wallet.revealKey(password);
  setBusy(submit, false, "Reveal");

  // The password has done its job whether or not it worked.
  $<HTMLInputElement>("#sheet-pass").value = "";
  if (!result.ok) return note("sheet-note", result.error);

  sheetSecret = result.data;
  $("#sheet-form").hidden = true;
  $("#sheet-reveal").hidden = false;

  const body = $("#sheet-secret");
  body.replaceChildren(
    kind === "phrase" ? phraseGrid(result.data) : el("p", "secret-key mono", result.data),
  );

  // Closes itself. A key left on screen outlives the reason it was opened.
  let left = 45;
  const tick = () => {
    $("#sheet-timer").textContent = `Hides in ${left}s`;
    if (left-- <= 0) closeSheet();
  };
  tick();
  sheetTimer = window.setInterval(tick, 1000);
});

$("#sheet-copy").addEventListener("click", async (event) => {
  const button = event.currentTarget as HTMLButtonElement;
  if (!sheetSecret) return;
  await navigator.clipboard.writeText(sheetSecret).catch(() => undefined);
  button.replaceChildren(icon("check", 13), el("span", undefined, "Copied"));
  setTimeout(() => button.replaceChildren(icon("copy", 13), el("span", undefined, "Copy")), 1600);
});

/* ---------------------------------------------------------------- agents -- */

function fail(body: HTMLElement, message: string): void {
  body.replaceChildren();
  const box = el("div", "empty");
  box.append(el("p", undefined, message));
  body.append(box);
}

async function loadAgents(): Promise<void> {
  const body = $("#agents-body");
  const result = await api.protocol.agents();
  if (!result.ok) return fail(body, result.error);

  if (result.data.agents.length === 0) {
    return fail(body, "No agents registered yet. Register one through the API to see it here.");
  }

  const table = el("table");
  headerRow(table, ["Agent", "Status", "Verification", "Risk", "Assets", "Chain"]);

  const tbody = el("tbody");
  for (const agent of result.data.agents) {
    const row = el("tr");

    const name = el("td");
    name.append(el("div", undefined, agent.name));
    const sub = el("div", "mono");
    sub.style.color = "var(--ink-dim)";
    sub.textContent = agent.slug;
    name.append(sub);
    if (agent.isDemo) name.append(tag("tag is-demo", "demo"));
    row.append(name);

    row.append(cell(tag("tag", agent.status.toLowerCase())));
    const verified = agent.verificationStatus === "VERIFIED";
    row.append(
      cell(
        tag(
          verified ? "tag is-good" : "tag is-warn",
          agent.verificationStatus.toLowerCase(),
          verified ? "check" : "minus",
        ),
      ),
    );
    row.append(el("td", undefined, agent.riskProfile.toLowerCase()));
    row.append(el("td", "mono", agent.assets.join(", ")));
    row.append(el("td", "mono", agent.chain));
    tbody.append(row);
  }
  table.append(tbody);

  body.replaceChildren(table);
}

/* ----------------------------------------------------------------- perps -- */

let markets: MarketRow[] = [];
let selected = "SOL";
let timeframe = "1h";
let chart: ChartHandle | null = null;
let loadToken = 0;
let logos: Record<string, string> = {};

/**
 * Logos arrive as data URIs from the main process and are set with `src` on an
 * <img>, never inlined as SVG markup — an <img> loads SVG in secure static
 * mode, so third-party artwork cannot execute anything.
 */
function logoFor(symbol: string): HTMLElement {
  const uri = logos[symbol];
  if (!uri) {
    return el("span", "market-logo-fallback", symbol.slice(0, 2));
  }
  const img = el("img", "market-logo") as HTMLImageElement;
  img.src = uri;
  img.alt = "";
  return img;
}

async function loadLogos(): Promise<void> {
  if (Object.keys(logos).length > 0) return;
  const result = await api.market.logos();
  if (!result.ok) return;
  logos = result.data;
  renderMarketRail();
  const title = document.querySelector(".market-title .market-logo-fallback");
  if (title && logos[selected]) title.replaceWith(logoFor(selected));
}

function tile(label: string, value: string, tone?: "is-up" | "is-down"): HTMLElement {
  const node = el("div", "tile");
  node.append(el("dt", undefined, label));
  node.append(el("dd", tone, value));
  return node;
}

function renderMarketRail(): void {
  const rows = $("#market-rows");
  const needle = $<HTMLInputElement>("#market-search").value.trim().toLowerCase();

  const visible = markets.filter((m) => {
    if (!needle) return true;
    return m.symbol.toLowerCase().includes(needle) || m.name.toLowerCase().includes(needle);
  });

  rows.replaceChildren();
  for (const market of visible) {
    const row = el("button", "market-row") as HTMLButtonElement;
    row.type = "button";
    row.dataset.symbol = market.symbol;
    if (market.symbol === selected) row.classList.add("is-active");
    const lead = el("span", "lead");
    lead.append(logoFor(market.symbol));
    lead.append(el("span", "sym", market.symbol));
    row.append(lead);
    row.append(el("span", "oi", formatCompact(market.openInterest)));
    rows.append(row);
  }
}

/* ----------------------------------------------------------------- trade -- */

/**
 * The account on the venue, and the ticket that trades it.
 *
 * Hyperliquid has no sign-up: an address is an account the moment it holds
 * collateral, and before that the exchange refuses it outright — "User does not
 * exist". So the unfunded state is not an error to hide, it is the first screen,
 * and it says exactly what to do about it.
 */
/**
 * Asks the venue whether it would honour a signature from this wallet, by
 * cancelling an order id that cannot exist. Authenticated exactly like an
 * order, but with nothing to cancel — so it answers the question without
 * placing anything or costing a cent.
 */
function signingCheck(): HTMLElement {
  const row = el("div", "signing-check");
  const button = el("button", "act", "Check signing") as HTMLButtonElement;
  const verdict = el("p", "hint");

  button.addEventListener("click", async () => {
    setBusy(button, true, "Check signing");
    const result = await api.trade.verifySigning();
    setBusy(button, false, "Check signing");

    if (!result.ok) {
      verdict.textContent = result.error;
      verdict.className = "hint is-bad";
      return;
    }

    const { result: outcome, detail } = result.data;
    verdict.className = `hint is-${outcome === "authenticated" ? "good" : outcome === "unfunded" ? "warn" : "bad"}`;
    verdict.textContent =
      outcome === "authenticated"
        ? `Signing works — the venue accepted a signed request from this wallet. ${detail}`
        : outcome === "unfunded"
          ? `Cannot tell yet. ${detail}`
          : `The venue refused it: ${detail}`;
  });

  row.append(button, verdict);
  return row;
}

function tradeAccountCard(account: TradeAccount | null, error: string | null): HTMLElement {
  const box = el("section", "trade-account");
  box.append(el("h3", undefined, "Hyperliquid account"));

  if (error) {
    box.append(el("p", "chart-empty", error));
    return box;
  }
  if (!account) {
    box.append(el("p", "chart-empty", "Reading the venue…"));
    return box;
  }

  if (!account.funded) {
    box.append(fundingSteps(account.address));
    box.append(signingCheck());
    return box;
  }

  const facts = el("dl", "tiles");
  facts.append(tile("Account value", usd(account.accountValue)));
  facts.append(tile("Withdrawable", usd(account.withdrawable)));
  facts.append(tile("Margin used", usd(account.marginUsed)));
  box.append(facts);

  if (account.positions.length > 0) {
    const table = el("table");
    headerRow(table, ["Position", "Size", "Entry", "Value", "Unrealised", "Liquidation"]);
    const body = el("tbody");
    for (const position of account.positions) {
      const row = el("tr");
      const long = position.size > 0;
      row.append(cell(tag(`tag is-${long ? "good" : "warn"}`, `${long ? "long" : "short"} ${position.symbol}`)));
      row.append(el("td", "num", formatCompact(Math.abs(position.size))));
      row.append(el("td", "num", position.entryPrice === null ? "—" : formatPrice(position.entryPrice)));
      row.append(el("td", "num", usd(position.positionValue)));

      const pnl = el("td", "num");
      pnl.append(percent(position.positionValue === 0 ? null : position.unrealizedPnl / Math.abs(position.positionValue)));
      pnl.append(el("span", "pnl-abs", ` ${usd(position.unrealizedPnl)}`));
      row.append(pnl);

      row.append(el("td", "num", position.liquidationPrice === null ? "—" : formatPrice(position.liquidationPrice)));
      body.append(row);
    }
    table.append(body);
    box.append(table);
  }

  box.append(signingCheck());
  return box;
}

/**
 * How to fund this address, stated the way the bridge actually works.
 *
 * The bridge credits whoever sent the USDC. So withdrawing from an exchange
 * straight to the bridge credits the exchange, not you — the USDC has to land
 * on this address first, and be forwarded from here. That is the whole reason
 * the second step is a button rather than an instruction.
 */
function fundingSteps(address: string): HTMLElement {
  const box = el("div", "trade-unfunded");
  box.append(icon("alert", 15));

  const copy = el("div", "funding-body");
  copy.append(el("b", undefined, "No collateral on this venue yet"));
  copy.append(
    el(
      "p",
      undefined,
      "Hyperliquid has no registration step — this address becomes an account the moment it " +
        "holds USDC. The bridge credits whoever sent the funds, so they have to come from " +
        "this address, not straight from an exchange.",
    ),
  );

  const steps = el("ol", "funding-steps");
  const step = (title: string, body: string) => {
    const item = el("li");
    item.append(el("b", undefined, title), el("span", undefined, body));
    return item;
  };
  steps.append(
    step(
      "1 · Send USDC and a little ETH here, on Arbitrum",
      "Native USDC (not USDC.e), from an exchange or another wallet. The ETH is only for the gas of the next step — a dollar or two is plenty.",
    ),
  );
  steps.append(
    step("2 · Forward it to the bridge", "Done from here, signed by this wallet, so the credit lands on this account."),
  );
  copy.append(steps);

  copy.append(receiveBlock(address));

  /* what is actually sitting here right now ------------------------------ */
  const status = el("div", "funding-status");
  status.append(el("p", "hint", "Checking Arbitrum…"));
  copy.append(status);

  const refresh = async () => {
    const result = await api.trade.funding();
    status.replaceChildren();

    if (!result.ok) {
      status.append(el("p", "hint", result.error));
      return;
    }

    const funds = result.data;
    const facts = el("dl", "tiles");
    facts.append(tile("USDC on Arbitrum", funds.usdc.toFixed(2)));
    facts.append(tile("ETH for gas", funds.gas.toFixed(5)));
    status.append(facts);

    if (funds.usdcE > 0) {
      const wrong = el("p", "gate-note is-bad");
      wrong.append(
        icon("alert", 14),
        el(
          "span",
          undefined,
          `${funds.usdcE.toFixed(2)} USDC.e is sitting here — the bridged token, not native USDC. ` +
            "Hyperliquid's bridge does not credit it, so it is not counted above and will not be " +
            "forwarded. Swap it to native USDC on Arbitrum first.",
        ),
      );
      status.append(wrong);
    }

    if (!funds.canDeposit) {
      status.append(
        el(
          "p",
          "hint",
          funds.usdc < funds.minimum
            ? `Waiting on at least ${funds.minimum} USDC here. The bridge keeps anything smaller without crediting it.`
            : "Waiting on a little ETH on Arbitrum to pay the gas for the transfer.",
        ),
      );
      return;
    }

    const send = el("button", "act is-primary funding-send") as HTMLButtonElement;
    send.append(el("span", undefined, `Forward ${funds.usdc.toFixed(2)} USDC to the bridge`));
    send.addEventListener("click", async () => {
      const agreed = window.confirm(
        `Send ${funds.usdc.toFixed(2)} USDC from this address to Hyperliquid's bridge on ` +
          "Arbitrum? It credits this account in about a minute. On-chain transfers cannot be undone.",
      );
      if (!agreed) return;

      setBusy(send, true, "Forward to the bridge");
      const sent = await api.trade.deposit(funds.usdc);
      setBusy(send, false, "Forward to the bridge");

      status.replaceChildren(
        el(
          "p",
          "hint",
          sent.ok
            ? `Sent. ${sent.data.amount.toFixed(2)} USDC is on its way; the venue credits it within a minute. ${sent.data.hash}`
            : sent.error,
        ),
      );
      if (sent.ok) setTimeout(() => void refresh(), 20_000);
    });
    status.append(send);
  };
  void refresh();

  box.append(copy);
  return box;
}

/**
 * The receiving side of a deposit.
 *
 * An address on its own is not an instruction. Two mistakes lose the money and
 * neither is recoverable: sending on the wrong chain, and sending the wrong
 * token — and on Arbitrum both native USDC and bridged USDC.e answer to the
 * symbol "USDC", so an exchange's asset picker cannot tell them apart for you.
 * Both are spelled out here, next to the address they apply to.
 */
function receiveBlock(address: string): HTMLElement {
  const box = el("div", "receive");

  const facts = el("dl", "receive-facts");
  const fact = (label: string, value: string, mono = false) => {
    const cell = el("div");
    cell.append(el("dt", undefined, label), el("dd", mono ? "mono" : "", value));
    return cell;
  };
  facts.append(fact("Network", "Arbitrum One · chain 42161"));
  facts.append(fact("Token", "Native USDC — not USDC.e"));
  box.append(facts);

  const row = el("div", "trade-address-row");
  const line = el("p", "trade-address mono", address);
  const copyButton = el("button", "chip-copy") as HTMLButtonElement;
  copyButton.append(icon("copy", 13));
  copyButton.title = "Copy the address";
  copyButton.addEventListener("click", async () => {
    await navigator.clipboard.writeText(address).catch(() => undefined);
    copyButton.replaceChildren(icon("check", 13));
    setTimeout(() => copyButton.replaceChildren(icon("copy", 13)), 1500);
  });
  row.append(line, copyButton);
  box.append(row);

  const qr = el("img", "receive-qr") as HTMLImageElement;
  qr.alt = "";
  box.append(qr);

  // The QR comes back with the balances; it is the same address either way.
  void api.trade.funding().then((result) => {
    if (result.ok) qr.src = result.data.qr;
    else qr.remove();
  });

  return box;
}

/** Confirmation for the one action in this app that spends money. */
function confirmTrade(detail: {
  symbol: string; side: "long" | "short"; size: number; limitPrice?: number;
  agentName: string; price: number | null;
}): Promise<boolean> {
  // Its own class: the secrets sheet lives in the markup permanently, and two
  // things answering to the same selector is a trap for whoever reads next.
  const overlay = el("div", "sheet is-trade");
  const card = el("div", "sheet-card");

  card.append(el("h2", undefined, `${detail.side === "long" ? "Long" : "Short"} ${detail.size} ${detail.symbol}`));

  const warn = el("p", "sheet-warn");
  warn.append(icon("alert", 14));
  warn.append(
    el(
      "span",
      undefined,
      "This is mainnet. The order is sent with real collateral the moment you confirm, " +
        "and a market order fills at whatever the book offers.",
    ),
  );
  card.append(warn);

  // Spelled out in the order it happens, because the order is the point.
  const steps = el("ol", "trade-steps");
  const seal = el("li");
  seal.append(el("b", undefined, "1 · Seal on MERIT"));
  seal.append(
    el(
      "span",
      undefined,
      `${detail.side === "long" ? "BUY" : "SHORT"} ${detail.size} ${detail.symbol} at ` +
        `${detail.price === null ? "market" : formatPrice(detail.price)}, under ${detail.agentName}. ` +
        "Written before the order goes out, and immutable afterwards.",
    ),
  );

  const send = el("li");
  send.append(el("b", undefined, "2 · Send to Hyperliquid"));
  send.append(
    el(
      "span",
      undefined,
      detail.limitPrice === undefined
        ? "Market order — crosses the book, capped at 3% slippage."
        : `Limit order resting at ${formatPrice(detail.limitPrice)}.`,
    ),
  );
  steps.append(seal, send);
  card.append(steps);

  const actions = el("div", "sheet-actions");
  const cancel = el("button", "act", "Cancel") as HTMLButtonElement;
  const go = el("button", "act is-primary", "Seal and send") as HTMLButtonElement;
  actions.append(cancel, go);
  card.append(actions);

  overlay.append(card);
  document.body.append(overlay);

  return new Promise<boolean>((resolve) => {
    const close = (answer: boolean) => {
      overlay.remove();
      resolve(answer);
    };
    cancel.addEventListener("click", () => close(false));
    go.addEventListener("click", () => close(true));
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) close(false);
    });
  });
}

function tradeTicket(
  snap: MarketSnapshot,
  agents: Agent[],
  tradeable: boolean,
  onDone: () => void,
): HTMLElement {
  const symbol = snap.symbol;
  const box = el("section", "trade-ticket");
  box.append(el("h3", undefined, `Trade ${symbol}`));

  let side: "long" | "short" = "long";
  const sides = el("div", "side-choice");
  const buttons: HTMLButtonElement[] = [];
  (["long", "short"] as const).forEach((value) => {
    const button = el("button", `side ${value} ${value === side ? "is-active" : ""}`, value) as HTMLButtonElement;
    button.type = "button";
    button.addEventListener("click", () => {
      side = value;
      buttons.forEach((other) => other.classList.toggle("is-active", other === button));
    });
    buttons.push(button);
    sides.append(button);
  });
  box.append(sides);

  const field = (label: string, node: HTMLElement) => {
    const wrap = el("div", "ticket-field");
    wrap.append(el("label", undefined, label), node);
    return wrap;
  };

  const size = el("input") as HTMLInputElement;
  size.type = "text";
  size.placeholder = "0.0";
  size.inputMode = "decimal";

  const price = el("input") as HTMLInputElement;
  price.type = "text";
  price.placeholder = "market";
  price.inputMode = "decimal";

  /* leverage --------------------------------------------------------------
     Per market, not per account, and it applies to the whole position on this
     asset — so it is its own action rather than a field on the order. */
  const leverage = el("select") as HTMLSelectElement;
  for (const step of [1, 2, 3, 5, 10, 20, 25, 40, 50].filter((n) => n <= snap.maxLeverage)) {
    leverage.append(new Option(`${step}×`, String(step)));
  }
  leverage.value = String(Math.min(5, snap.maxLeverage));

  const applyLeverage = el("button", "act lever-apply", "Set") as HTMLButtonElement;
  const leverRow = el("div", "lever-row");
  leverRow.append(leverage, applyLeverage);

  const agentPick = el("select") as HTMLSelectElement;
  if (agents.length === 0) {
    agentPick.append(new Option("No agents registered", ""));
    agentPick.disabled = true;
  } else {
    for (const agent of agents) agentPick.append(new Option(agent.name, agent.id));
  }

  const confidence = el("input") as HTMLInputElement;
  confidence.type = "text";
  confidence.value = "0.60";
  confidence.inputMode = "decimal";

  const rationale = el("textarea") as HTMLTextAreaElement;
  rationale.rows = 2;
  rationale.placeholder = "Why this call, and what would make it wrong. Sealed with the commitment.";

  const grid = el("div", "ticket-grid");
  grid.append(field("Size", size), field("Limit price", price));
  grid.append(field(`Leverage · max ${snap.maxLeverage}×`, leverRow), field("Confidence", confidence));
  grid.append(field("Under agent", agentPick));
  box.append(grid);
  box.append(field("Rationale", rationale));

  const note = el("p", "gate-note", "");
  note.hidden = true;
  box.append(note);

  const say = (text: string, tone: "bad" | "warn") => {
    note.className = `gate-note is-${tone}`;
    note.replaceChildren(icon(tone === "bad" ? "alert" : "seal", 14), el("span", undefined, text));
    note.hidden = false;
  };

  applyLeverage.addEventListener("click", async () => {
    setBusy(applyLeverage, true, "Set");
    const result = await api.trade.leverage(symbol, Number(leverage.value));
    setBusy(applyLeverage, false, "Set");
    say(
      result.ok
        ? `${symbol} leverage set to ${leverage.value}× (cross margin).`
        : result.error,
      result.ok ? "warn" : "bad",
    );
  });

  const submit = el("button", "act is-primary ticket-submit") as HTMLButtonElement;
  submit.append(el("span", undefined, "Review order"));
  box.append(submit);

  if (!tradeable) {
    submit.disabled = true;
    applyLeverage.disabled = true;
    [size, price, confidence, agentPick, leverage].forEach((node) => {
      (node as HTMLInputElement).disabled = true;
    });
    box.append(
      el(
        "p",
        "hint ticket-locked",
        "Fund the account above to trade. The form is here so you can see what it asks for.",
      ),
    );
  }

  submit.addEventListener("click", async () => {
    note.hidden = true;

    const amount = Number(size.value);
    if (!Number.isFinite(amount) || amount <= 0) {
      return say("Enter a size greater than zero.", "bad");
    }
    if (!agentPick.value) {
      return say("Pick the agent this call is made under — a commitment has to name one.", "bad");
    }

    const limit = price.value.trim() ? Number(price.value) : undefined;
    if (limit !== undefined && (!Number.isFinite(limit) || limit <= 0)) {
      return say("That limit price is not a number.", "bad");
    }

    const agreed = await confirmTrade({
      symbol,
      side,
      size: amount,
      limitPrice: limit,
      agentName: agents.find((a) => a.id === agentPick.value)?.name ?? "—",
      price: limit ?? null,
    });
    if (!agreed) return;

    setBusy(submit, true, "Review order");
    const result = await api.trade.place({
      symbol,
      side,
      size: amount,
      limitPrice: limit,
      agentId: agentPick.value,
      confidence: confidence.value.trim() || "0.5",
      rationale: rationale.value.trim() || "Placed from the console.",
    });
    setBusy(submit, false, "Review order");

    if (!result.ok) return say(result.error, "bad");

    const receipt = result.data.receipt;
    say(
      receipt.status === "filled"
        ? `Sealed on MERIT and filled: ${receipt.size} ${symbol} at ${formatPrice(receipt.price ?? 0)}.`
        : receipt.status === "resting"
          ? `Sealed on MERIT. The order is resting on the book (id ${receipt.orderId}).`
          : "Sealed on MERIT. The venue's answer was unrecognised — check the position table.",
      "warn",
    );
    size.value = "";
    onDone();
  });

  return box;
}

/* ------------------------------------------------------------------ book -- */

/**
 * The order book, built once and then written into.
 *
 * Rebuilding the rows on every poll would restart every transition and make the
 * depth bars jump; keeping the twelve rows and updating their contents is what
 * lets the bars slide and the changed levels flash. Rows are keyed by depth,
 * not by price — position is what the reader is tracking, and the level at a
 * given depth is what changes underneath it.
 */
const BOOK_DEPTH = 12;

interface BookSide {
  rows: Array<{ node: HTMLElement; price: HTMLElement; size: HTMLElement; bar: HTMLElement }>;
  /** Last sizes, to tell a lift from a fill. */
  previous: number[];
}

function createBookSide(title: string, side: "bid" | "ask"): { node: HTMLElement; view: BookSide } {
  const box = el("div", "book");
  box.dataset.side = side;
  box.append(el("h3", undefined, title));

  const list = el("div", "book-rows");
  const rows: BookSide["rows"] = [];

  for (let depth = 0; depth < BOOK_DEPTH; depth += 1) {
    const node = el("div", "book-row is-empty");
    // The flash marks a level as *recently* changed, so it has to end when the
    // animation does; left on, the class accumulates and stops meaning anything.
    node.addEventListener("animationend", () => node.classList.remove("is-lift", "is-fill"));
    const bar = el("i", "book-depth");
    const price = el("span", `book-price ${side}`);
    const size = el("span", "book-size");
    node.append(bar, price, size);
    list.append(node);
    rows.push({ node, price, size, bar });
  }

  box.append(list);
  return { node: box, view: { rows, previous: [] } };
}

function updateBookSide(view: BookSide, levels: Array<[number, number]>): void {
  // Scaled against the deepest level on this side, so the bars describe the
  // shape of the book rather than the size of the asset.
  const largest = Math.max(...levels.map(([, size]) => size), 0);

  view.rows.forEach((row, depth) => {
    const level = levels[depth];

    if (!level) {
      row.node.classList.add("is-empty");
      row.price.textContent = "";
      row.size.textContent = "";
      row.bar.style.width = "0%";
      return;
    }

    const [price, size] = level;
    row.node.classList.remove("is-empty");
    row.price.textContent = formatPrice(price);
    row.size.textContent = formatCompact(size);
    row.bar.style.width = `${largest > 0 ? (size / largest) * 100 : 0}%`;

    const before = view.previous[depth];
    if (before !== undefined && before !== size) {
      // Re-adding a class does not restart a running animation; a forced reflow
      // between the remove and the add does.
      const direction = size > before ? "is-lift" : "is-fill";
      row.node.classList.remove("is-lift", "is-fill");
      void row.node.offsetWidth;
      row.node.classList.add(direction);
    }
  });

  view.previous = levels.map(([, size]) => size);
}

/** Polls the book while the market view is on screen, and only then. */
let bookPoll: number | undefined;

function stopBookPoll(): void {
  window.clearInterval(bookPoll);
  bookPoll = undefined;
}

async function loadPerps(): Promise<void> {
  try {
    await loadPerpsInner();
  } catch (error) {
    // A thrown render is otherwise a silently half-drawn panel: the sections
    // appended before the throw stay on screen and look like the whole view.
    console.error("perps render failed", error);
    fail($("#market-view"), `Could not render this market: ${String(error)}`);
  }
}

async function loadPerpsInner(): Promise<void> {
  const view = $("#market-view");

  if (markets.length === 0) {
    const list = await api.market.list();
    if (!list.ok) return fail(view, list.error);
    markets = list.data;
    renderMarketRail();
    void loadLogos();
  }

  const token = ++loadToken;
  const result = await api.market.snapshot(selected, timeframe);
  // A slower earlier request must not overwrite a newer selection.
  if (token !== loadToken) return;
  if (!result.ok) return fail(view, result.error);

  const snap = result.data;
  chart?.destroy();
  view.replaceChildren();

  const title = el("div", "market-title");
  title.append(logoFor(snap.symbol));
  title.append(el("h2", undefined, snap.symbol));
  if (snap.name && snap.name !== snap.symbol) title.append(el("span", "name", snap.name));
  title.append(tag("tag", "perp"));
  view.append(title);

  view.append(
    el("div", "market-price", snap.markPrice === null ? "\u2014" : formatPrice(snap.markPrice)),
  );

  if (snap.description) {
    // The venue's own description of the contract — leverage and settlement,
    // which the ticker alone does not say.
    view.append(el("p", "market-note", snap.description));
  }

  if (snap.degraded.length > 0) {
    const degraded = el(
      "div",
      "degraded",
      `Hyperliquid did not return: ${snap.degraded.join(", ")}. Those figures are shown as “—” rather than estimated.`,
    );
    degraded.prepend(icon("alert", 14));
    view.append(degraded);
  }

  const tiles = el("dl", "tiles");
  tiles.append(tile("Mark", snap.markPrice === null ? "—" : formatPrice(snap.markPrice)));
  tiles.append(tile("Spot", snap.spotPrice === null ? "—" : formatPrice(snap.spotPrice)));
  tiles.append(
    tile("Open interest", snap.openInterest === null ? "—" : formatCompact(snap.openInterest)),
  );
  tiles.append(
    tile(
      "Funding / 1h",
      // Hourly rates run to millionths; four decimals rounded every one to zero.
      snap.fundingRate === null ? "—" : `${(snap.fundingRate * 100).toFixed(5)}%`,
      snap.fundingRate === null ? undefined : snap.fundingRate >= 0 ? "is-up" : "is-down",
    ),
  );
  tiles.append(tile("24h volume", `$${formatCompact(snap.volumeQuote)}`));
  view.append(tiles);

  const head = el("div", "chart-head");
  head.append(el("h3", undefined, `${snap.symbol} · ${timeframe} candles`));
  const readout = el("div", "readout");
  head.append(readout);
  view.append(head);

  const plot = el("div", "chart");
  view.append(plot);

  const key = el("div", "chart-key");
  const up = el("span", "up");
  up.append(el("i"), document.createTextNode("up"));
  const down = el("span", "down");
  down.append(el("i"), document.createTextNode("down"));
  key.append(
    up,
    down,
    el("span", undefined, "volume in the lower pane \u00b7 drag to pan, scroll to zoom"),
  );
  view.append(key);

  // The venue account and the ticket, above the book the ticket trades into.
  const trading = el("div", "trade-grid");
  const accountSlot = el("div");
  const ticketSlot = el("div");
  trading.append(accountSlot, ticketSlot);
  view.append(trading);

  const refreshAccount = async () => {
    const [account, agentList] = await Promise.all([api.trade.account(), api.trade.agents()]);
    accountSlot.replaceChildren(
      tradeAccountCard(account.ok ? account.data : null, account.ok ? null : account.error),
    );
    ticketSlot.replaceChildren(
      tradeTicket(
        snap,
        agentList.ok ? agentList.data.agents : [],
        account.ok && account.data.funded,
        () => void refreshAccount(),
      ),
    );
  };
  void refreshAccount();

  const books = el("div", "book-grid");
  const spread = el("div", "book-spread");
  const bidSide = createBookSide("Bids", "bid");
  const askSide = createBookSide("Asks", "ask");
  books.append(spread, bidSide.node, askSide.node);
  view.append(books);

  const paint = (bids: Array<[number, number]>, asks: Array<[number, number]>) => {
    updateBookSide(bidSide.view, bids);
    updateBookSide(askSide.view, asks);

    const best = { bid: bids[0]?.[0], ask: asks[0]?.[0] };
    if (best.bid === undefined || best.ask === undefined) {
      spread.textContent = "";
      return;
    }
    const width = best.ask - best.bid;
    const mid = (best.ask + best.bid) / 2;
    spread.replaceChildren(
      el("span", undefined, "Spread"),
      el("b", undefined, formatPrice(width)),
      // Basis points, because the absolute width means nothing across assets
      // priced three orders of magnitude apart.
      el("span", undefined, `${((width / mid) * 10_000).toFixed(1)} bps`),
    );
  };

  paint(snap.bids, snap.asks);

  // Live from here. Two seconds is frequent enough that the book visibly
  // breathes, and light enough to be one small request.
  stopBookPoll();
  bookPoll = window.setInterval(async () => {
    const result = await api.market.book(snap.symbol);
    // A market change between the request and its answer would paint the wrong
    // book onto this one.
    if (result.ok && selected === snap.symbol) paint(result.data.bids, result.data.asks);
  }, 2000);


  // The exposure section is appended empty and filled in afterwards. It reads a
  // different system over a different connection, and blocking the chart — the
  // thing the panel exists for — on that call left the plot missing for as long
  // as MERIT took to answer.
  const exposure = el("div", "exposure");
  exposure.append(el("h3", undefined, `Your committed decisions \u00b7 ${snap.symbol}`));
  const exposureBody = el("div");
  exposure.append(exposureBody);
  view.append(exposure);

  const showReadout = (candle: Candle | null) => {
    readout.replaceChildren();
    if (!candle) return;
    const parts: Array<[string, string]> = [
      ["O", formatPrice(candle.open)],
      ["H", formatPrice(candle.high)],
      ["L", formatPrice(candle.low)],
      ["C", formatPrice(candle.close)],
      ["Vol", formatCompact(candle.volume)],
    ];
    for (const [label, value] of parts) {
      const span = el("span");
      span.append(document.createTextNode(`${label} `), el("b", undefined, value));
      readout.append(span);
    }
  };

  chart = renderChart(plot, snap.candles, { timeframe, onHover: showReadout });

  const open = await api.protocol.decisions({ status: "OPEN" });
  if (token !== loadToken) return;

  if (!open.ok) {
    exposureBody.append(el("p", "chart-empty", open.error));
    return;
  }

  const mine = open.data.filter((d) => d.asset.toUpperCase() === snap.symbol.toUpperCase());
  if (mine.length === 0) {
    exposureBody.append(
      el(
        "p",
        "chart-empty",
        "Nothing committed on this asset. The market data above is the venue's, not yours.",
      ),
    );
    return;
  }

  const table = el("table");
  headerRow(table, ["Action", "Price", "Quantity", "Commitment", "Committed"]);
  const body = el("tbody");
  for (const decision of mine) {
    const row = el("tr");
    row.append(el("td", undefined, decision.action));
    row.append(el("td", "num", decision.price));
    row.append(el("td", "num", decision.quantity));
    row.append(el("td", "mono", `${decision.commitmentHash.slice(0, 14)}\u2026`));
    row.append(el("td", "mono", new Date(decision.committedAt).toISOString().slice(0, 16)));
    body.append(row);
  }
  table.append(body);
  exposureBody.append(table);
}

$("#market-rows").addEventListener("click", (event) => {
  const row = (event.target as HTMLElement).closest<HTMLElement>("[data-symbol]");
  if (!row?.dataset.symbol || row.dataset.symbol === selected) return;
  selected = row.dataset.symbol;
  renderMarketRail();
  void loadPerps();
});

$("#market-search").addEventListener("input", renderMarketRail);

$("#timeframes").addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLElement>("[data-tf]");
  if (!button?.dataset.tf || button.dataset.tf === timeframe) return;
  timeframe = button.dataset.tf;
  document
    .querySelectorAll("#timeframes button")
    .forEach((b) => b.classList.toggle("is-active", (b as HTMLElement).dataset.tf === timeframe));
  void loadPerps();
});

/* -------------------------------------------------------------------- lp -- */

async function loadLp(): Promise<void> {
  const body = $("#lp-body");
  const venue = await api.venues.positions();
  if (!venue.ok) return fail(body, venue.error);

  if (!venue.data.connected) {
    return fail(
      body,
      "No venue adapter is connected. Liquidity positions live on the venue, not in MERIT, " +
        "so there is nothing to show until an adapter is wired up. The console will not " +
        "display placeholder positions in the meantime.",
    );
  }

  if (venue.data.lp.length === 0) {
    return fail(body, `Connected to ${venue.data.name}, but it reports no liquidity positions.`);
  }

  const table = el("table");
  headerRow(table, ["Venue", "Pool", "Liquidity", "Fees earned", "Range"]);

  const tbody = el("tbody");
  for (const position of venue.data.lp) {
    const row = el("tr");
    row.append(el("td", "mono", String(position.venue)));
    row.append(el("td", "mono", String(position.pool)));
    row.append(el("td", "num", String(position.liquidity)));
    row.append(el("td", "num", String(position.feesEarned)));
    row.append(
      cell(
        tag(
          position.inRange ? "tag is-good" : "tag is-warn",
          position.inRange ? "in range" : "out of range",
          position.inRange ? "check" : "minus",
        ),
      ),
    );
    tbody.append(row);
  }
  table.append(tbody);
  body.replaceChildren(table);
}

/* -------------------------------------------------------------- settings -- */

function credentialField(opts: {
  label: string; hint: string; name: string; present: boolean; placeholder: string;
}): HTMLElement {
  const field = el("div", "field");
  field.append(el("label", undefined, opts.label));
  field.append(el("p", "hint", opts.hint));

  const row = el("div", "field-row");
  const input = el("input") as HTMLInputElement;
  input.type = "password";
  input.placeholder = opts.present ? "•••••••• stored" : opts.placeholder;
  row.append(input);

  const save = el("button", "act is-primary", "Save") as HTMLButtonElement;
  save.addEventListener("click", async () => {
    if (!input.value.trim()) return;
    const result = await api.vault.setSecret(opts.name, input.value.trim());
    input.value = "";
    if (!result.ok) window.alert(result.error);
    void loadSettings();
  });
  row.append(save);

  if (opts.present) {
    const clear = el("button", "act", "Remove") as HTMLButtonElement;
    clear.addEventListener("click", async () => {
      await api.vault.clearSecret(opts.name);
      void loadSettings();
    });
    row.append(clear);
  }

  field.append(row);
  return field;
}

/** Identity the window is currently running under. */
let currentSession: Session | null = null;
let currentAddress: string | null = null;

/** The account, as the protocol sees it and as this machine holds it. */
function profilePanel(status: VaultStatus): HTMLElement {
  const field = el("section", "field");
  field.append(el("label", undefined, "Account"));
  field.append(
    el(
      "p",
      "hint",
      "The wallet this window signs with, and the key its signature earned. " +
        "Signing out locks the wallet; the wallet file itself stays on this machine.",
    ),
  );

  const cardEl = el("div", "account-card");

  /* identity ------------------------------------------------------------- */
  const head = el("div", "account-head");
  const avatar = el("span", "avatar");
  if (currentAddress) paintAvatar(avatar, currentAddress);
  head.append(avatar);

  const identity = el("div", "account-name");
  identity.append(el("b", undefined, currentAddress ? shortAddress(currentAddress) : "Locked"));
  identity.append(el("span", "mono", currentAddress ?? "no wallet unlocked"));
  head.append(identity);

  if (currentAddress) {
    const copy = el("button", "chip-copy") as HTMLButtonElement;
    copy.append(icon("copy", 13));
    copy.title = "Copy the address";
    copy.addEventListener("click", async () => {
      await navigator.clipboard.writeText(currentAddress!).catch(() => undefined);
      copy.replaceChildren(icon("check", 13));
      setTimeout(() => copy.replaceChildren(icon("copy", 13)), 1500);
    });
    head.append(copy);
  }
  cardEl.append(head);

  /* session -------------------------------------------------------------- */
  const facts = el("dl", "account-facts");
  const fact = (label: string, value: string) => {
    const cell = el("div");
    cell.append(el("dt", undefined, label), el("dd", undefined, value));
    return cell;
  };
  facts.append(fact("Deployment", status.meritBaseUrl));
  facts.append(fact("API key", currentSession?.prefix ?? "unverified"));
  facts.append(fact("Key label", currentSession?.label ?? "—"));
  facts.append(fact("Scopes", currentSession?.scopes.join(", ") || "—"));
  cardEl.append(facts);

  /* secrets -------------------------------------------------------------- */
  const secrets = el("div", "account-secrets");
  secrets.append(
    el("div", "account-secrets-head", "Recovery"),
    el(
      "p",
      "hint",
      "Exporting either of these asks for your password again. They never leave this machine.",
    ),
  );

  const buttons = el("div", "field-row");
  const phrase = el("button", "act") as HTMLButtonElement;
  phrase.append(icon("mark", 13), el("span", undefined, "Seed phrase"));
  phrase.addEventListener("click", () => openSheet("phrase"));

  const key = el("button", "act") as HTMLButtonElement;
  key.append(icon("lock", 13), el("span", undefined, "Private key"));
  key.addEventListener("click", () => openSheet("key"));

  buttons.append(phrase, key);
  secrets.append(buttons);
  cardEl.append(secrets);

  field.append(cardEl);

  const row = el("div", "field-row");
  const out = el("button", "act", "Sign out") as HTMLButtonElement;
  out.addEventListener("click", () => void signOut());
  row.append(out);
  field.append(row);

  return field;
}

/**
 * Which service answers the chat panel. Anthropic is called through its own SDK
 * with a pinned model; OpenRouter is a gateway, so it needs both a key and a
 * choice of model — the picker only lists models that can call tools, because
 * an agent that cannot call commit_decision cannot do this job.
 */
function agentPanel(status: VaultStatus): HTMLElement {
  const field = el("section", "field");
  field.append(el("label", undefined, "Chat agent"));
  field.append(
    el(
      "p",
      "hint",
      "The model behind the Chat panel. It proposes; you approve; MERIT records — " +
        "whichever provider runs it.",
    ),
  );

  const choice = el("div", "provider-choice");
  const providers: Array<[AgentConfig["provider"], string, string]> = [
    ["anthropic", "Anthropic", "claude-opus-5, direct"],
    ["openrouter", "OpenRouter", "any tool-capable model"],
  ];

  providers.forEach(([value, title, note]) => {
    const option = el(
      "button",
      `provider ${status.agent.provider === value ? "is-active" : ""}`,
    ) as HTMLButtonElement;
    option.type = "button";
    option.append(el("b", undefined, title), el("span", undefined, note));

    const key = value === "anthropic" ? status.anthropicApiKey : status.openrouterApiKey;
    option.append(el("i", `provider-dot ${key ? "is-set" : ""}`));

    option.addEventListener("click", async () => {
      await api.agent.config({ provider: value });
      void loadSettings();
    });
    choice.append(option);
  });
  field.append(choice);

  field.append(
    status.agent.provider === "openrouter"
      ? credentialField({
          label: "OpenRouter API key",
          hint: "From openrouter.ai/keys. Held in this machine's keyring; requests are made by the app, never by this window.",
          name: "openrouterApiKey",
          present: status.openrouterApiKey,
          placeholder: "sk-or-v1-…",
        })
      : credentialField({
          label: "Anthropic API key",
          hint: "From console.anthropic.com. Held in this machine's keyring; requests are made by the app, never by this window.",
          name: "anthropicApiKey",
          present: status.anthropicApiKey,
          placeholder: "sk-ant-…",
        }),
  );

  if (status.agent.provider === "openrouter") field.append(modelPicker(status));
  return field;
}

function modelPicker(status: VaultStatus): HTMLElement {
  const wrap = el("div", "model-field");
  const label = el("label", undefined, "Model");
  label.setAttribute("for", "openrouter-model");
  wrap.append(label);

  const row = el("div", "field-row");
  const select = el("select") as HTMLSelectElement;
  select.id = "openrouter-model";
  select.disabled = true;
  select.append(new Option("Loading the catalogue…", ""));
  row.append(select);
  wrap.append(row);

  const note = el("p", "hint model-note", "");
  wrap.append(note);

  void (async () => {
    const result = await api.agent.models();
    select.replaceChildren();

    if (!result.ok) {
      select.append(new Option("Could not reach OpenRouter", ""));
      note.textContent = result.error;
      return;
    }

    select.disabled = false;
    select.append(new Option("Choose a model…", ""));

    const describe = (model: OpenRouterModel) => {
      const context = model.contextLength ? `${Math.round(model.contextLength / 1000)}K ctx` : null;
      // Prices come per token; per million is the unit everyone quotes.
      const price =
        model.promptPrice !== null && model.completionPrice !== null
          ? `$${(model.promptPrice * 1e6).toFixed(2)}/$${(model.completionPrice * 1e6).toFixed(2)} per M`
          : null;
      return [context, price].filter(Boolean).join(" · ");
    };

    for (const model of result.data) {
      const option = new Option(`${model.name} — ${describe(model)}`, model.id);
      option.selected = model.id === status.agent.openrouterModel;
      select.append(option);
    }

    note.textContent = `${result.data.length} tool-capable models. Models without tool support are hidden — the agent needs them to seal a commitment.`;

    select.addEventListener("change", async () => {
      await api.agent.config({ openrouterModel: select.value });
      const chosen = result.data.find((model) => model.id === select.value);
      note.textContent = chosen
        ? `Saved. Chat now runs on ${chosen.name}.`
        : "No model chosen — Chat will refuse until one is picked.";
    });
  })();

  return wrap;
}

async function loadSettings(): Promise<void> {
  const body = $("#settings-body");
  const result = await api.vault.status();
  if (!result.ok) return fail(body, result.error);
  const status = result.data;

  body.replaceChildren();

  if (!status.encryptionAvailable) {
    const notice = el("div", "notice is-bad");
    notice.prepend(icon("alert", 15));
    notice.append(
      el(
        "p",
        undefined,
        "This system has no OS keyring available, so credentials cannot be stored encrypted. " +
          "Saving is disabled rather than writing your keys to disk in plaintext.",
      ),
    );
    body.append(notice);
  }

  body.append(profilePanel(status));
  body.append(agentPanel(status));
}

/* ------------------------------------------------------------------ chat -- */

const transcript = $("#transcript");
const approvals = $("#approvals");
const composer = $<HTMLFormElement>("#composer");
const promptField = $<HTMLTextAreaElement>("#prompt");
const sendButton = $<HTMLButtonElement>("#send");
const newChatButton = $<HTMLButtonElement>("#new-chat");

/** The agent turn currently receiving tokens, so the caret lands on it alone. */
let streamingTurn: HTMLElement | null = null;
let streamingBody: HTMLElement | null = null;

function endStreaming(): void {
  streamingTurn?.classList.remove("is-streaming");
  streamingTurn = null;
  streamingBody = null;
}

function atBottom(): boolean {
  return transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 120;
}

/**
 * Follow new output only when the reader is already at the bottom. Yanking the
 * view down while someone is re-reading an earlier turn is the single most
 * irritating thing a streaming transcript can do.
 */
function follow(wasAtBottom: boolean): void {
  if (wasAtBottom) transcript.scrollTop = transcript.scrollHeight;
}

function turn(cls: string, text = ""): { node: HTMLElement; body: HTMLElement } {
  $("#welcome")?.remove();

  const wasAtBottom = atBottom();
  const node = el("div", `turn ${cls}`);

  if (cls === "is-agent") {
    const glyph = el("div", "turn-mark");
    glyph.append(icon("mark", 15));
    node.append(glyph);
  }

  const body = el("div", "turn-body", text);
  // Tool traces and errors read as annotations rather than speech, so each is
  // led by its own glyph instead of the agent's mark.
  if (cls === "is-tool") body.prepend(icon("tool", 12));
  if (cls === "is-error") body.prepend(icon("alert", 14));
  node.append(body);
  transcript.append(node);
  follow(wasAtBottom);

  return { node, body };
}

api.chat.onText((delta) => {
  if (!streamingBody) {
    const created = turn("is-agent");
    streamingTurn = created.node;
    streamingBody = created.body;
    streamingTurn.classList.add("is-streaming");
  }

  const wasAtBottom = atBottom();
  streamingBody.textContent += delta;
  follow(wasAtBottom);
});

api.chat.onTool((name) => {
  endStreaming();
  turn("is-tool", name);
});

api.chat.onApproval((request) => {
  endStreaming();

  const card = el("div", "approval");
  card.dataset.id = request.id;
  const approvalTitle = el("div", "approval-title", "Approve commitment");
  approvalTitle.prepend(icon("seal", 13));
  card.append(approvalTitle);
  card.append(el("div", "approval-summary", request.summary));
  card.append(
    el(
      "p",
      "approval-note",
      "Sealing this writes an immutable commitment to MERIT before you execute. It cannot be edited or deleted afterwards.",
    ),
  );

  const actions = el("div", "approval-actions");
  const approve = el("button", "act is-primary", "Seal commitment") as HTMLButtonElement;
  const decline = el("button", "act", "Decline") as HTMLButtonElement;

  approve.addEventListener("click", () => void api.chat.approve(request.id, true));
  decline.addEventListener("click", () => void api.chat.approve(request.id, false));

  actions.append(approve, decline);
  card.append(actions);
  approvals.append(card);
});

api.chat.onApprovalSettled((id) => {
  approvals.querySelector(`[data-id="${id}"]`)?.remove();
});

/* --------------------------------------------------------------- composer -- */

function resizeComposer(): void {
  promptField.style.height = "auto";
  promptField.style.height = `${promptField.scrollHeight}px`;
}

function syncSendState(): void {
  sendButton.disabled = promptField.value.trim().length === 0;
}

promptField.addEventListener("input", () => {
  resizeComposer();
  syncSendState();
});

promptField.addEventListener("keydown", (event) => {
  // Enter sends; Shift+Enter is a newline. Cmd/Ctrl+Enter also sends, for anyone
  // carrying the habit over from an editor.
  if (event.key !== "Enter") return;
  if (event.shiftKey) return;
  event.preventDefault();
  composer.requestSubmit();
});

$("#suggestions")?.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLElement>("[data-fill]");
  if (!button?.dataset.fill) return;
  promptField.value = button.dataset.fill;
  resizeComposer();
  syncSendState();
  promptField.focus();
});

composer.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = promptField.value.trim();
  if (!text) return;

  turn("is-user", text);
  promptField.value = "";
  resizeComposer();
  sendButton.disabled = true;
  endStreaming();

  const result = await api.chat.send(text);
  endStreaming();
  if (!result.ok) turn("is-error", result.error);

  syncSendState();
  promptField.focus();
});

newChatButton.addEventListener("click", async () => {
  await api.chat.reset();
  endStreaming();
  approvals.replaceChildren();

  const welcome = el("div", "welcome");
  welcome.id = "welcome";
  welcome.append(el("h2", undefined, "Think a call through."));
  welcome.append(
    el(
      "p",
      undefined,
      "When you want it on the record, the agent seals it as a commitment. You approve first, " +
        "and you execute afterwards in your own wallet — the protocol never touches your funds.",
    ),
  );
  transcript.replaceChildren(welcome);

  promptField.value = "";
  resizeComposer();
  syncSendState();
  promptField.focus();
});

syncSendState();

/* ------------------------------------------------------------------ gate -- */

const gate = $("#gate");
const shell = $(".shell");
const gateUrl = $<HTMLInputElement>("#gate-url");
const railAccount = $("#rail-account");

type View = "choose" | "create" | "backup" | "confirm" | "import" | "unlock";
const views = new Map<View, HTMLElement>();
document
  .querySelectorAll<HTMLElement>(".gate-view")
  .forEach((view) => views.set(view.dataset.view as View, view));

function showView(name: View): void {
  views.forEach((view, key) => (view.hidden = key !== name));
  views.get(name)?.querySelector<HTMLElement>("input, textarea")?.focus();
}

/**
 * A gradient derived from the address itself. Two wallets are told apart at a
 * glance, before anyone has read a character of base58 — which is the only way
 * a wrong-account mistake gets caught in practice.
 */
function paintAvatar(target: HTMLElement, address: string): void {
  let hash = 2166136261;
  for (let i = 0; i < address.length; i += 1) {
    hash ^= address.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const hue = (seed: number) => Math.abs(Math.imul(hash, seed)) % 360;
  target.style.background =
    `linear-gradient(135deg, hsl(${hue(1)} 62% 52%), hsl(${hue(31)} 58% 42%) 55%, hsl(${hue(131)} 66% 58%))`;
}

/** Base58 is unreadable at length; the ends are what people actually compare. */
function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function note(id: string, text: string, tone: "bad" | "warn" = "bad"): void {
  const slot = $(`#${id}`);
  slot.replaceChildren(icon("alert", 14), el("span", undefined, text));
  slot.className = `gate-note is-${tone}`;
  slot.hidden = false;
}

/**
 * The wallet is written to disk before sign-in is attempted, so a deployment
 * that is down leaves a perfectly good wallet behind an error message. Say that
 * plainly and offer the retry, rather than letting it read as "import failed".
 */
function noteWithRetry(id: string, reason: string, label: string): void {
  const slot = $(`#${id}`);
  slot.replaceChildren(
    icon("alert", 14),
    el(
      "div",
      "note-body",
      `Your wallet is saved on this machine — this was the sign-in that failed. ${reason}`,
    ),
  );

  const retry = el("button", "note-retry", "Try signing in again") as HTMLButtonElement;
  retry.type = "button";
  retry.addEventListener("click", () => void signIn(retry, label));
  slot.querySelector(".note-body")!.append(retry);

  slot.className = "gate-note is-warn";
  slot.hidden = false;
}

function clearNotes(): void {
  document.querySelectorAll<HTMLElement>(".gate-note").forEach((slot) => {
    slot.hidden = true;
    slot.replaceChildren();
  });
}

/**
 * Creating and importing both write over whatever wallet is already here, and
 * the one being replaced can only come back from its own backup. Ask once, in
 * the same words, from either screen.
 */
function confirmReplace(): boolean {
  if (!walletOnDisk) return true;

  return window.confirm(
    walletIsLegacy
      ? "Replace the Solana-era wallet on this machine? This build cannot open it " +
          "anyway; its own seed phrase or private key still restores it in a Solana wallet."
      : "Replace the wallet currently on this machine? It can only be recovered " +
          "afterwards from its own seed phrase or private key.",
  );
}

function setBusy(button: HTMLButtonElement, busy: boolean, label: string): void {
  button.disabled = busy;
  button.replaceChildren();
  if (busy) button.append(icon("spinner", 14));
  button.append(el("span", undefined, busy ? "Working…" : label));
}

/**
 * What the operator pasted. Cosmetic only — the main process parses it properly
 * and is the one that decides — but naming the format as it is typed catches a
 * truncated key or an eleven-word phrase before a passphrase is even chosen.
 */
type SecretKind = "phrase" | "key" | "none";

function detectSecret(value: string): { kind: SecretKind; label: string } {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { kind: "none", label: "12 or 24 words · 0x private key" };
  }

  const words = trimmed.split(/\s+/);
  if (words.length > 1) {
    if (words.length === 12 || words.length === 24) {
      return { kind: "phrase", label: `${words.length}-word seed phrase` };
    }
    return { kind: "none", label: `${words.length} words · a phrase is 12 or 24` };
  }

  // A private key with or without the prefix; both are pasted in practice.
  const hex = trimmed.startsWith("0x") ? trimmed.slice(2) : trimmed;
  if (!/^[0-9a-fA-F]*$/.test(hex)) {
    return { kind: "none", label: "not hex — check for a stray character" };
  }
  if (hex.length === 64) {
    return { kind: "key", label: "EVM private key · 32 bytes" };
  }
  return { kind: "none", label: `${hex.length} hex characters · a key is 64` };
}

/* ------------------------------------------------------------ sign-in -- */

/**
 * The wallet signs a one-time challenge from the deployment and gets an API key
 * back. Everything before this point is local; this is the only step that talks
 * to the protocol.
 */
async function signIn(button: HTMLButtonElement, label: string): Promise<void> {
  setBusy(button, true, label);
  const result = await api.auth.signIn(gateUrl.value);
  setBusy(button, false, label);

  if (!result.ok) {
    return walletJustSaved
      ? noteWithRetry(activeNoteId(), result.error, label)
      : note(activeNoteId(), result.error);
  }

  walletJustSaved = false;
  enterConsole(result.data.session, result.data.wallet.address);
}

function activeNoteId(): string {
  const view = [...views.entries()].find(([, node]) => !node.hidden)?.[0];
  if (view === "choose") return "choose-note";
  if (view === "import") return "import-note";
  if (view === "confirm") return "confirm-note";
  if (view === "backup") return "create-note-backup";
  return "unlock-note";
}

/* ------------------------------------------------------------- create -- */

/** Held only between generating the phrase and confirming it was written down. */
let pendingPhrase: string[] = [];

/** The address shown on the unlock screen, for its copy button. */
let gateAddress: string | null = null;

/** Whether creating or importing would overwrite a wallet already held here. */
let walletOnDisk = false;

/** That wallet is from the Solana build, so replacing it loses nothing usable. */
let walletIsLegacy = false;

/** Set once create or import has written a wallet, so a failed sign-in can say so. */
let walletJustSaved = false;

/** Mirrors wallet.ts. Kept in step by the message the main process sends back. */
const MIN_PASSPHRASE_LENGTH = 10;

function renderPhrase(): void {
  const grid = $("#phrase");
  grid.replaceChildren();
  grid.classList.add("is-hidden");
  $("#phrase-cover").hidden = false;

  pendingPhrase.forEach((word, index) => {
    const cell = el("span");
    cell.append(el("b", undefined, String(index + 1)), el("span", undefined, word));
    grid.append(cell);
  });

  // The grid starts covered, so the control offers the way in, not the way out.
  $("#phrase-reveal").replaceChildren(el("span", undefined, "Reveal"));

  // Each new phrase is a new promise to keep.
  const ack = $<HTMLInputElement>("#backup-ack");
  ack.checked = false;
  $<HTMLButtonElement>("#backup-done").disabled = true;
}

/**
 * Finish creating: drop the phrase from the page and sign in.
 *
 * Shared by the checkbox path and the word-check path, so the wallet is in the
 * same state either way — the check is reassurance, not a different outcome.
 */
async function finishBackup(button: HTMLButtonElement, label: string): Promise<void> {
  pendingPhrase = [];
  $("#phrase").replaceChildren();
  await signIn(button, label);
}

/**
 * Password quality, shown while it is being chosen. Length dominates because it
 * dominates the actual cost of guessing; character classes are worth a point,
 * not four.
 */
function passphraseScore(value: string): { score: number; label: string } {
  if (value.length === 0) return { score: 0, label: "" };

  const classes =
    Number(/[a-z]/.test(value)) +
    Number(/[A-Z]/.test(value)) +
    Number(/\d/.test(value)) +
    Number(/[^\w]/.test(value));

  let score = 1;
  if (value.length >= MIN_PASSPHRASE_LENGTH) score += 1;
  if (value.length >= 16 || classes >= 3) score += 1;
  if (value.length >= 24 && classes >= 2) score += 1;

  if (value.length < MIN_PASSPHRASE_LENGTH) {
    return { score: 1, label: `${MIN_PASSPHRASE_LENGTH - value.length} more characters` };
  }
  return { score, label: ["", "weak", "fair", "strong", "very strong"][score] };
}

/** Three positions, chosen per wallet, so the check cannot be muscle-memoried. */
let checkedPositions: number[] = [];

function renderPhraseCheck(): void {
  const positions = new Set<number>();
  while (positions.size < 3) positions.add(Math.floor(Math.random() * pendingPhrase.length));
  checkedPositions = [...positions].sort((a, b) => a - b);

  const grid = $("#phrase-check");
  grid.replaceChildren();

  checkedPositions.forEach((position) => {
    const wrap = el("div");
    const input = el("input") as HTMLInputElement;
    input.id = `word-${position}`;
    input.autocomplete = "off";
    input.spellcheck = false;

    const label = el("label", undefined, `Word ${position + 1}`) as HTMLLabelElement;
    label.htmlFor = input.id;

    wrap.append(label, input);
    grid.append(wrap);
  });
}

document.querySelectorAll<HTMLElement>("[data-go]").forEach((button) => {
  button.addEventListener("click", () => {
    clearNotes();
    const target = button.dataset.go as View;
    if (target === "confirm") {
      if (pendingPhrase.length === 0) return;
      renderPhraseCheck();
    }
    if (target === "backup") renderPhrase();
    showView(target);
  });
});

document.querySelectorAll<HTMLButtonElement>(".gate-eye").forEach((button) => {
  button.addEventListener("click", () => {
    const field = $<HTMLInputElement>(`#${button.dataset.reveals}`);
    const shown = field.type === "text";
    field.type = shown ? "password" : "text";
    button.setAttribute("aria-label", shown ? "Show the password" : "Hide the password");
    button.replaceChildren(icon(shown ? "reveal" : "conceal", 14));
    field.focus();
  });
});

$("#create-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  clearNotes();

  const pass = $<HTMLInputElement>("#create-pass").value;
  const again = $<HTMLInputElement>("#create-pass2").value;
  if (pass !== again) return note("create-note", "The two passwords do not match.");
  if (!confirmReplace()) return;

  const button = (event.target as HTMLFormElement).querySelector<HTMLButtonElement>(".gate-submit")!;
  setBusy(button, true, "Generate wallet");
  const result = await api.wallet.create(pass, walletOnDisk);
  setBusy(button, false, "Generate wallet");

  if (!result.ok) return note("create-note", result.error);

  walletJustSaved = true;
  walletOnDisk = true;
  // Whatever was here has been replaced; a second attempt in this session is
  // replacing the new wallet, not the old one.
  walletIsLegacy = false;
  pendingPhrase = result.data.mnemonic.split(" ");
  renderPhrase();
  showView("backup");
});

function togglePhrase(hide?: boolean): void {
  const grid = $("#phrase");
  const hidden = grid.classList.toggle("is-hidden", hide);
  $("#phrase-cover").hidden = !hidden;
  $("#phrase-reveal").replaceChildren(el("span", undefined, hidden ? "Reveal" : "Hide"));
}

$("#phrase-reveal").addEventListener("click", () => togglePhrase());
$("#phrase-cover").addEventListener("click", () => togglePhrase(false));

$<HTMLInputElement>("#create-pass").addEventListener("input", (event) => {
  const meter = $("#create-strength");
  const { score, label } = passphraseScore((event.target as HTMLInputElement).value);
  meter.hidden = score === 0;
  meter.dataset.score = String(score);
  meter.querySelector(".strength-label")!.textContent = label;
});

$("#copy-address").addEventListener("click", async (event) => {
  const button = event.currentTarget as HTMLButtonElement;
  if (!gateAddress) return;
  await navigator.clipboard.writeText(gateAddress).catch(() => undefined);
  button.replaceChildren(icon("check", 13));
  setTimeout(() => button.replaceChildren(icon("copy", 13)), 1500);
});

$("#phrase-copy").addEventListener("click", async (event) => {
  const button = event.currentTarget as HTMLButtonElement;
  try {
    await navigator.clipboard.writeText(pendingPhrase.join(" "));
    button.replaceChildren(icon("check", 13), el("span", undefined, "Copied"));
    setTimeout(() => button.replaceChildren(icon("copy", 13), el("span", undefined, "Copy")), 1600);
  } catch {
    button.replaceChildren(el("span", undefined, "Copy blocked — write it down"));
  }
});

$<HTMLInputElement>("#backup-ack").addEventListener("change", (event) => {
  $<HTMLButtonElement>("#backup-done").disabled = !(event.target as HTMLInputElement).checked;
});

$("#backup-done").addEventListener("click", (event) =>
  void finishBackup(event.currentTarget as HTMLButtonElement, "Create wallet and sign in"),
);

$("#confirm-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  clearNotes();

  const wrong = checkedPositions.filter(
    (position) =>
      $<HTMLInputElement>(`#word-${position}`).value.trim().toLowerCase() !==
      pendingPhrase[position],
  );
  if (wrong.length > 0) {
    return note("confirm-note", "Those words do not match the phrase. Check your copy of it.");
  }

  await finishBackup(
    (event.target as HTMLFormElement).querySelector<HTMLButtonElement>(".gate-submit")!,
    "Confirm and sign in",
  );
});

$<HTMLTextAreaElement>("#import-phrase").addEventListener("input", (event) => {
  const { kind, label } = detectSecret((event.target as HTMLTextAreaElement).value);
  const slot = $("#import-detect");
  slot.dataset.kind = kind;
  slot.querySelector(".detect-text")!.textContent = label;
});

$("#import-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  clearNotes();

  const field = $<HTMLTextAreaElement>("#import-phrase");
  const button = (event.target as HTMLFormElement).querySelector<HTMLButtonElement>(".gate-submit")!;
  const secret = field.value;
  const pass = $<HTMLInputElement>("#import-pass").value;

  const { kind } = detectSecret(secret);
  if (kind === "none") {
    return note("import-note", "That is not a seed phrase or a private key yet — check the line above.");
  }

  if (!confirmReplace()) return;

  setBusy(button, true, "Import and sign in");
  const result =
    kind === "phrase" ? await api.wallet.import(secret, pass) : await api.wallet.importKey(secret, pass);

  if (!result.ok) {
    setBusy(button, false, "Import and sign in");
    return note("import-note", result.error);
  }

  walletJustSaved = true;
  walletOnDisk = true;
  walletIsLegacy = false;

  // The pasted secret has done its job; it does not stay in the page.
  field.value = "";
  $("#import-detect").dataset.kind = "none";
  $("#import-detect").querySelector(".detect-text")!.textContent =
    "12 or 24 words · base58 key · JSON key file";
  await signIn(button, "Import and sign in");
});

$("#unlock-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  clearNotes();

  const button = (event.target as HTMLFormElement).querySelector<HTMLButtonElement>(".gate-submit")!;
  const field = $<HTMLInputElement>("#unlock-pass");

  setBusy(button, true, "Unlock and sign in");
  const result = await api.wallet.unlock(field.value);
  if (!result.ok) {
    setBusy(button, false, "Unlock and sign in");
    return note("unlock-note", result.error);
  }

  field.value = "";
  await signIn(button, "Unlock and sign in");
});

$("#forget-wallet").addEventListener("click", async () => {
  const confirmed = window.confirm(
    "Remove this wallet from the machine? Only the twelve-word seed phrase can " +
      "bring the account back — there is no other copy.",
  );
  if (!confirmed) return;

  const result = await api.wallet.forget();
  if (!result.ok) return window.alert(result.error);
  openGate(result.data, null);
});

/* -------------------------------------------------------------- screens -- */

function openGate(walletStatus: WalletStatus, baseUrl: string | null, rejected?: string): void {
  shell.hidden = true;
  gate.hidden = false;
  railAccount.hidden = true;

  // The file is 27 MB; it is only worth decoding for someone who is looking at it.
  const video = $<HTMLVideoElement>("#gate-video");
  if (!video.src) {
    video.src = "desktop-background.mp4";
    void video.play().catch(() => undefined);
    // A looping video behind a login form is exactly the motion someone with
    // this preference set asked not to see. The frame stays as a still.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) video.pause();
  }

  if (baseUrl) gateUrl.value = baseUrl;
  clearNotes();

  walletOnDisk = walletStatus.exists;
  walletIsLegacy = walletStatus.legacy;

  // A wallet from the Solana build cannot be unlocked, so sending the operator
  // to a password prompt would waste their time. Start them at the way out.
  if (walletStatus.legacy) {
    showView("choose");
    note(
      "choose-note",
      `The wallet on this machine (${walletStatus.address ?? "unknown"}) was created when the ` +
        "console was on Solana. This build signs with EVM keys, so that file can no longer be " +
        "opened. Import an EVM wallet below, or create a new one — the old file is replaced either way.",
      "warn",
    );
    return;
  }

  if (walletStatus.exists && walletStatus.address) {
    gateAddress = walletStatus.address;
    paintAvatar($("#unlock-avatar"), walletStatus.address);
    $("#unlock-address").textContent = shortAddress(walletStatus.address);
    showView("unlock");
    if (rejected) note("unlock-note", rejected);
  } else {
    showView("choose");
  }
}

function enterConsole(session: Session | null, address: string | null): void {
  currentSession = session;
  currentAddress = address;

  gate.hidden = true;
  shell.hidden = false;
  railAccount.hidden = false;

  if (address) {
    paintAvatar($("#rail-avatar"), address);
    $("#rail-address").textContent = shortAddress(address);
  }
  $("#account-key").textContent = session ? session.prefix : "key unverified";

  $<HTMLVideoElement>("#gate-video").pause();
  void refreshHealth();
  // The dashboard rendered before sign-in, without an address to greet.
  show("dashboard");
}

async function signOut(): Promise<void> {
  const confirmed = window.confirm(
    "Sign out? The wallet locks and the API key is dropped. Your password " +
      "unlocks it again — the wallet itself stays on this machine.",
  );
  if (!confirmed) return;

  const result = await api.auth.signOut();
  if (!result.ok) return window.alert(result.error);

  // The transcript was produced under the old session; it does not belong to
  // whoever signs in next.
  await api.chat.reset();
  transcript.replaceChildren();
  currentSession = null;
  currentAddress = null;
  show("dashboard");
  openGate(result.data.wallet, result.data.status.meritBaseUrl);
}

$("#sign-out").addEventListener("click", () => void signOut());

/* ------------------------------------------------------------------ boot -- */

hydrateIcons();
show("dashboard");

async function boot(): Promise<void> {
  const state = await api.auth.state();

  // A vault that cannot even be read is a bug worth showing rather than a
  // reason to hand someone an empty console.
  if (!state.ok) {
    return openGate(
      { exists: false, unlocked: false, address: null, legacy: false },
      null,
      state.error,
    );
  }

  if (state.data.signedIn) {
    enterConsole(state.data.session, state.data.wallet.address);
  } else {
    openGate(state.data.wallet, state.data.status.meritBaseUrl, state.data.rejected);
  }
}

void boot();
setInterval(() => void refreshHealth(), 30_000);

export {};
