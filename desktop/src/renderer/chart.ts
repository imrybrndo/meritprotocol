/**
 * Candlestick + volume chart, built on TradingView's Lightweight Charts.
 *
 * Why the library rather than the hand-drawn SVG it replaces: panning, zooming,
 * kinetic scroll, and auto-scaling are a lot of fiddly state to get right, and
 * a canvas renderer handles a few thousand candles far better than an SVG that
 * rebuilds its DOM on every interaction. Lightweight Charts is Apache-2.0 and
 * bundles locally, so nothing is fetched at runtime — which matters here,
 * because the renderer's CSP forbids it from reaching the network at all.
 *
 * (The other "TradingView SDK" — Advanced Charts — is a different product: it
 * needs a separate licence agreement and a datafeed adapter, and it is far
 * heavier than this panel warrants.)
 *
 * The accessibility choices from the hand-drawn version are carried over as
 * configuration, not lost to the library's defaults:
 *
 *  - Green up, red down, filled — the convention every trader already reads.
 *    Note the cost, which was the reason for the earlier blue/red pair: green
 *    and red separate by ΔE 2.2 under deuteranopia, so a red-green reader
 *    cannot tell one candle from the other by colour. Direction is therefore
 *    carried a second way below.
 *  - Every price is written out beside the chart — mark, spot, 24h change — so
 *    the numbers, not the hues, remain the source of truth.
 *  - Volume lives in its own pane, never as a second y-scale on the price plot.
 *    Two scales on one plot invent a correlation that is not in the data.
 */

import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// Mirrors the tokens in styles.css, which mirror the site's app/globals.css.
// lightweight-charts takes literals rather than CSS variables, so these are
// the one place the palette is duplicated — keep them in step by hand.
const UP = "#2fbf71"; /* --profit */
const DOWN = "#e5484d"; /* --loss */
const GRID = "#1f242a"; /* --line */
const AXIS_INK = "#626c77"; /* --ink-dim */
const SURFACE = "#08090b"; /* --base */
const RAISED = "#14171b"; /* --raised */
const INK = "#e9ecef"; /* --ink */
const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

export function formatPrice(value: number): string {
  const abs = Math.abs(value);
  const decimals = abs >= 1000 ? 2 : abs >= 1 ? 3 : 6;
  return value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatCompact(value: number): string {
  return Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(value);
}

export interface ChartHandle {
  destroy(): void;
}

export interface ChartOptions {
  timeframe: string;
  onHover(candle: Candle | null): void;
}

export function renderChart(
  container: HTMLElement,
  candles: Candle[],
  options: ChartOptions,
): ChartHandle {
  container.replaceChildren();

  if (candles.length === 0) {
    const empty = document.createElement("p");
    empty.className = "chart-empty";
    empty.textContent = "No candles returned for this market and timeframe.";
    container.append(empty);
    return { destroy() {} };
  }

  const chart: IChartApi = createChart(container, {
    // autoSize uses the library's own ResizeObserver, so the plot follows the
    // window without any resize plumbing of ours.
    autoSize: true,
    layout: {
      background: { type: ColorType.Solid, color: SURFACE },
      textColor: AXIS_INK,
      fontSize: 10,
      fontFamily: MONO,
      panes: { separatorColor: GRID, separatorHoverColor: "rgba(47, 191, 113, 0.2)" },
    },
    // Hairline, solid, one step off the surface — never dashed.
    grid: {
      vertLines: { color: GRID, style: 0 },
      horzLines: { color: GRID, style: 0 },
    },
    rightPriceScale: { borderColor: GRID, scaleMargins: { top: 0.08, bottom: 0.08 } },
    timeScale: { borderColor: GRID, timeVisible: options.timeframe !== "1d", secondsVisible: false },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: { color: AXIS_INK, width: 1, style: 0, labelBackgroundColor: RAISED },
      horzLine: { color: AXIS_INK, width: 1, style: 0, labelBackgroundColor: RAISED },
    },
    handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
    handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true },
    kineticScroll: { mouse: false, touch: true },
  });

  const priceSeries: ISeriesApi<"Candlestick"> = chart.addSeries(CandlestickSeries, {
    upColor: UP,
    borderUpColor: UP,
    wickUpColor: UP,
    downColor: DOWN,
    borderDownColor: DOWN,
    wickDownColor: DOWN,
    priceLineColor: UP,
    priceLineWidth: 1,
  });

  priceSeries.setData(
    candles.map((c) => ({
      time: Math.floor(c.time / 1000) as UTCTimestamp,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    })),
  );

  // Pane 1, not an overlay price scale on pane 0.
  const volumePane = chart.addPane();
  const volumeSeries: ISeriesApi<"Histogram"> = chart.addSeries(
    HistogramSeries,
    { priceFormat: { type: "volume" }, priceLineVisible: false },
    1,
  );

  volumeSeries.setData(
    candles.map((c) => ({
      time: Math.floor(c.time / 1000) as UTCTimestamp,
      value: c.volume,
      color: c.close >= c.open ? "rgba(47, 191, 113, 0.35)" : "rgba(229, 72, 77, 0.35)",
    })),
  );

  volumePane.setStretchFactor(22);
  chart.panes()[0].setStretchFactor(78);

  const byTime = new Map(candles.map((c) => [Math.floor(c.time / 1000), c]));

  const onCrosshair = (param: { time?: unknown }) => {
    const key = typeof param.time === "number" ? param.time : null;
    options.onHover(key === null ? null : (byTime.get(key) ?? null));
  };
  chart.subscribeCrosshairMove(onCrosshair);

  // Open on the most recent stretch rather than the whole history, so the first
  // view is legible and the rest is a scroll away.
  const visible = Math.min(candles.length, 140);
  chart.timeScale().setVisibleLogicalRange({
    from: candles.length - visible,
    to: candles.length + 2,
  });


  return {
    destroy() {
      chart.unsubscribeCrosshairMove(onCrosshair);
      chart.remove();
    },
  };
}
