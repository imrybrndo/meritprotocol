/**
 * Hyperliquid perps market data.
 *
 * One public POST endpoint answers everything: `/info` takes a `type` and
 * returns whatever that type describes. No key, no signing — this module reads
 * the market and cannot place an order.
 *
 * Lives in the main process for the same reason the MERIT client does: the
 * renderer's CSP blocks it from reaching the network at all, so every outbound
 * request crosses the IPC bridge and is auditable in one place.
 *
 * Two properties of this venue shape the code below:
 *
 *  - `metaAndAssetCtxs` returns price, 24h change, volume and open interest for
 *    every asset in a single response, so the market grid costs one request
 *    rather than one per market.
 *  - The universe keeps delisted assets in place so indexes stay stable. They
 *    are filtered out everywhere; an asset that no longer trades is not a
 *    market to show.
 */

import { inlineImage, mapLimited } from "./logos";

const BASE = "https://api.hyperliquid.xyz/info";

/** The venue's own interval strings, so no translation table is needed. */
export const TIMEFRAMES = ["5m", "15m", "1h", "4h", "1d"] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

/** Milliseconds per candle, for asking the venue for a bounded window. */
const INTERVAL_MS: Record<Timeframe, number> = {
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
};

async function info<T>(body: Record<string, unknown>): Promise<T> {
  const response = await fetch(BASE, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Hyperliquid ${String(body.type)} failed with ${response.status}`);
  }
  return (await response.json()) as T;
}

/** A number the venue sent as a string. Absent and unparseable both mean null. */
function num(value: string | undefined | null): number | null {
  if (value === undefined || value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export interface MarketRow {
  symbol: string;
  name: string;
  /** Open interest in base units, as the venue reports it. */
  openInterest: number;
  /** The venue's cap for this asset — leverage is per-market, not per-account. */
  maxLeverage: number;
  description: string | null;
}

interface Universe {
  name: string;
  szDecimals: number;
  maxLeverage: number;
  isDelisted?: boolean;
}

interface AssetCtx {
  funding?: string;
  openInterest?: string;
  prevDayPx?: string;
  dayNtlVlm?: string;
  premium?: string;
  oraclePx?: string;
  markPx?: string;
  midPx?: string;
}

/**
 * Small TTL cache. One dashboard render asks for the market list more than
 * once, and a venue that throttles turns the extra calls into blank prices.
 */
function cached<T>(ttlMs: number, load: () => Promise<T>): () => Promise<T> {
  let value: { at: number; data: T } | null = null;
  let inflight: Promise<T> | null = null;

  return async () => {
    if (value && Date.now() - value.at < ttlMs) return value.data;
    // Concurrent callers share one request instead of racing to refill.
    inflight ??= load()
      .then((data) => {
        value = { at: Date.now(), data };
        return data;
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  };
}

/**
 * The universe paired with its contexts, delisted assets dropped — but their
 * positions remembered.
 *
 * `index` is the asset's place in the *unfiltered* universe, which is how the
 * venue addresses it when an order is placed. Delisted entries are kept in the
 * list precisely so those indexes never shift; renumbering after the filter
 * would address a different asset entirely.
 */
async function loadAssets(): Promise<Array<{ meta: Universe; ctx: AssetCtx; index: number }>> {
  const [meta, ctxs] = await info<[{ universe: Universe[] }, AssetCtx[]]>({
    type: "metaAndAssetCtxs",
  });

  // The two arrays are index-aligned; that is the only thing joining them.
  return meta.universe
    .map((entry, index) => ({ meta: entry, ctx: ctxs[index] ?? {}, index }))
    .filter((asset) => !asset.meta.isDelisted);
}

const assets = cached(30_000, loadAssets);

async function loadMarkets(): Promise<MarketRow[]> {
  return (await assets()).map(({ meta, ctx }) => ({
    symbol: meta.name,
    name: meta.name,
    openInterest: num(ctx.openInterest) ?? 0,
    maxLeverage: meta.maxLeverage,
    description: `Perpetual · up to ${meta.maxLeverage}× leverage`,
  }));
}

export const listMarkets = cached(30_000, loadMarkets);

/** The venue's own index for a market, for anything that places an order. */
export async function assetIndex(symbol: string): Promise<number> {
  const asset = (await assets()).find((entry) => entry.meta.name === symbol);
  if (!asset) throw new Error(`${symbol} is not a live market on this venue.`);
  return asset.index;
}

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface RawCandle {
  t: number;
  o: string;
  h: string;
  l: string;
  c: string;
  v: string;
}

/**
 * Candles for one market. The venue takes a time window rather than a count, so
 * the count is turned into a window; it caps a response at 5000 either way.
 */
export async function candles(
  symbol: string,
  timeframe: Timeframe,
  limit = 300,
): Promise<Candle[]> {
  const endTime = Date.now();
  const startTime = endTime - INTERVAL_MS[timeframe] * limit;

  const raw = await info<RawCandle[]>({
    type: "candleSnapshot",
    req: { coin: symbol, interval: timeframe, startTime, endTime },
  });

  return raw.map((candle) => ({
    time: candle.t,
    open: num(candle.o) ?? 0,
    high: num(candle.h) ?? 0,
    low: num(candle.l) ?? 0,
    close: num(candle.c) ?? 0,
    volume: num(candle.v) ?? 0,
  }));
}

export interface MarketSnapshot {
  symbol: string;
  name: string;
  maxLeverage: number;
  description: string | null;
  markPrice: number | null;
  /** The oracle price the venue marks against, not a spot venue's last trade. */
  spotPrice: number | null;
  openInterest: number | null;
  /** Hourly funding, as a fraction. */
  fundingRate: number | null;
  volumeQuote: number;
  candles: Candle[];
  bids: Array<[number, number]>;
  asks: Array<[number, number]>;
  degraded: string[];
}

interface L2Book {
  levels?: [Array<{ px: string; sz: string }>, Array<{ px: string; sz: string }>];
}

/**
 * One round trip per source for the whole panel. Each is settled independently
 * so a single failing endpoint blanks its own figure instead of the entire
 * view — and the panel is told which one, rather than quietly showing a stale
 * or invented number.
 */
export async function snapshot(symbol: string, timeframe: Timeframe): Promise<MarketSnapshot> {
  const [assetList, candleData, book] = await Promise.allSettled([
    assets(),
    // Enough history that panning has somewhere to go.
    candles(symbol, timeframe, 1000),
    info<L2Book>({ type: "l2Book", coin: symbol }),
  ]);

  const degraded: string[] = [];
  const value = <T>(result: PromiseSettledResult<T>, label: string): T | null => {
    if (result.status === "fulfilled") return result.value;
    degraded.push(label);
    return null;
  };

  const asset = value(assetList, "markets")?.find((entry) => entry.meta.name === symbol);
  const ctx = asset?.ctx;
  const levels = value(book, "orderbook")?.levels;

  const side = (entries: Array<{ px: string; sz: string }> = []): Array<[number, number]> =>
    entries
      .slice(0, 12)
      .map((level) => [num(level.px) ?? 0, num(level.sz) ?? 0] as [number, number]);

  return {
    symbol,
    name: asset?.meta.name ?? symbol,
    maxLeverage: asset?.meta.maxLeverage ?? 1,
    description: asset ? `Perpetual · up to ${asset.meta.maxLeverage}× leverage` : null,
    markPrice: num(ctx?.markPx),
    spotPrice: num(ctx?.oraclePx),
    openInterest: num(ctx?.openInterest),
    fundingRate: num(ctx?.funding),
    volumeQuote: num(ctx?.dayNtlVlm) ?? 0,
    candles: value(candleData, "candles") ?? [],
    bids: side(levels?.[0]),
    asks: side(levels?.[1]),
    degraded,
  };
}

/**
 * The order book alone.
 *
 * `snapshot` fetches it alongside candles and market stats, which is right for
 * a panel load. A book that refreshes every couple of seconds must not drag
 * 1000 candles behind it, so it gets its own call.
 */
export async function book(
  symbol: string,
): Promise<{ bids: Array<[number, number]>; asks: Array<[number, number]> }> {
  const raw = await info<L2Book>({ type: "l2Book", coin: symbol });

  const side = (entries: Array<{ px: string; sz: string }> = []): Array<[number, number]> =>
    entries
      .slice(0, 12)
      .map((level) => [num(level.px) ?? 0, num(level.sz) ?? 0] as [number, number]);

  return { bids: side(raw.levels?.[0]), asks: side(raw.levels?.[1]) };
}

export interface MarketPulse {
  symbol: string;
  name: string;
  price: number | null;
  /** Fractional change over the venue's own 24h window. */
  change24h: number | null;
  volumeQuote: number | null;
  openInterest: number;
  /** Closes, oldest first, for the sparkline. */
  spark: number[];
}


/**
 * A day of context for every market shown.
 *
 * Price, 24h change, volume and open interest all come from the single
 * `metaAndAssetCtxs` response — the venue publishes `prevDayPx`, so the change
 * is its own figure rather than something inferred from candles. Only the
 * sparklines need a request each, and only for the markets actually rendered.
 */
async function loadOverview(limit = 12): Promise<MarketPulse[]> {
  const all = await assets();

  const notional = (asset: { ctx: AssetCtx }) =>
    (num(asset.ctx.markPx) ?? 0) * (num(asset.ctx.openInterest) ?? 0);

  const ranked = [...all].sort((a, b) => notional(b) - notional(a)).slice(0, limit);

  // ETH is the console's home market and the denominator of the wallet balance;
  // it is never allowed to fall off the list.
  if (!ranked.some((asset) => asset.meta.name === "ETH")) {
    const eth = all.find((asset) => asset.meta.name === "ETH");
    if (eth) ranked.splice(ranked.length - 1, 1, eth);
  }

  return mapLimited(ranked, 4, async ({ meta, ctx }): Promise<MarketPulse> => {
    const price = num(ctx.markPx);
    const previous = num(ctx.prevDayPx);

    let spark: number[] = [];
    try {
      spark = (await candles(meta.name, "1h", 24)).map((candle) => candle.close);
    } catch {
      // One market without history is a flat row, not a broken dashboard.
    }

    return {
      symbol: meta.name,
      name: meta.name,
      price,
      change24h:
        price !== null && previous !== null && previous !== 0 ? (price - previous) / previous : null,
      volumeQuote: num(ctx.dayNtlVlm),
      openInterest: num(ctx.openInterest) ?? 0,
      spark,
    };
  });
}

export const overview = cached(60_000, loadOverview);

/* ------------------------------------------------------------------ logos -- */

/**
 * Asset icons.
 *
 * Hyperliquid publishes no icon in its API; these come from the same path its
 * own front end uses, which is undocumented and may move. That is survivable:
 * a miss returns nothing and the row falls back to the symbol's initials, so
 * the market list never depends on this working. The fetch itself, and the
 * guards on it, live in logos.ts.
 */
const ICON_BASE = "https://app.hyperliquid.xyz/coins";
let logoCache: Record<string, string> | null = null;

const fetchLogo = (symbol: string) =>
  inlineImage(`${ICON_BASE}/${encodeURIComponent(symbol)}.svg`);

export async function logos(): Promise<Record<string, string>> {
  if (logoCache) return logoCache;

  const markets = await listMarkets();
  const fetched = await mapLimited(markets, 8, (market) => fetchLogo(market.symbol));

  const map: Record<string, string> = {};
  markets.forEach((market, index) => {
    const uri = fetched[index];
    if (uri) map[market.symbol] = uri;
  });

  logoCache = map;
  return map;
}
