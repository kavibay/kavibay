// SPDX-License-Identifier: MIT
/**
 * Stocks domain logic: watchlist normalization, Yahoo chart parsing and the
 * cache-backed HTTP provider used by the contract widget.
 */

import type { HttpCapability } from "@sdk/contract/sdk";

export const MAX_SYMBOLS = 8;
export const POLL_MS = 5 * 60_000;
export const CACHE_TTL_MS = 5 * 60_000;

export const DEFAULT_SYMBOLS = ["AAPL", "MSFT", "GOOGL", "BTC-USD"] as const;

export interface StocksSettings {
  /** Watchlist tickers (Yahoo symbols), max MAX_SYMBOLS. */
  symbols: string[];
}

/** Schema-driven widget configuration. The contract form stores primitives. */
export interface StocksConfig {
  /** Comma-separated Yahoo symbols, normalized before use. */
  symbols: string;
}

export interface QuoteRow {
  symbol: string;
  name: string;
  price: number;
  previousClose: number;
  changePercent: number;
  currency: string;
}

export interface QuoteDetail extends QuoteRow {
  dayHigh: number | null;
  dayLow: number | null;
  volume: number | null;
  /** Close prices for sparkline (oldest → newest). */
  sparkline: number[];
}

export type QuoteRowResult =
  | { ok: true; data: QuoteRow }
  | { ok: false; symbol: string; error: string };

export type QuoteDetailResult =
  | { ok: true; data: QuoteDetail }
  | { ok: false; symbol: string; error: string };

/** Provider seam — V1 ships Yahoo; Finnhub can plug in later. */
export interface QuoteProvider {
  fetchQuotes(symbols: string[], opts?: { bypassCache?: boolean }): Promise<QuoteRowResult[]>;
  fetchDetail(symbol: string, opts?: { bypassCache?: boolean }): Promise<QuoteDetailResult>;
}

export const DEFAULT_STOCKS_SETTINGS: StocksSettings = {
  symbols: [...DEFAULT_SYMBOLS],
};

export const DEFAULT_STOCKS_CONFIG: StocksConfig = {
  symbols: DEFAULT_SYMBOLS.join(", "),
};

/** Uppercase ticker; strip junk; empty → null. */
export function normalizeSymbol(raw: string): string | null {
  const s = raw.trim().toUpperCase().replace(/\s+/g, "");
  if (!s) return null;
  // Yahoo allows letters, digits, dots, hyphens, equals (e.g. BRK.B, BTC-USD).
  if (!/^[A-Z0-9.^=-]+$/.test(s)) return null;
  return s;
}

/**
 * Normalize settings: unique symbols, capped, defaults if empty.
 */
export function normalizeStocksSettings(raw: unknown): StocksSettings {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const list = Array.isArray(o.symbols) ? o.symbols : [];
  const seen = new Set<string>();
  const symbols: string[] = [];
  for (const item of list) {
    if (typeof item !== "string") continue;
    const sym = normalizeSymbol(item);
    if (!sym || seen.has(sym)) continue;
    seen.add(sym);
    symbols.push(sym);
    if (symbols.length >= MAX_SYMBOLS) break;
  }
  return { symbols: symbols.length ? symbols : [...DEFAULT_SYMBOLS] };
}

/** Convert a normalized symbol list to the primitive used by the config form. */
export function serializeStocksSymbols(symbols: string[]): string {
  return normalizeStocksSettings({ symbols }).symbols.join(", ");
}

/** Normalize the schema-driven config handed to a widget at setup time. */
export function normalizeStocksConfig(raw: unknown): StocksConfig {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const rawSymbols = typeof value.symbols === "string" ? value.symbols.split(",") : [];
  return { symbols: serializeStocksSymbols(rawSymbols) };
}

/** Add a symbol if valid, unique, and under cap. Returns next list (or same). */
export function addSymbol(symbols: string[], raw: string): string[] {
  const sym = normalizeSymbol(raw);
  if (!sym) return symbols;
  const normalized = normalizeStocksSettings({ symbols }).symbols;
  if (normalized.includes(sym) || normalized.length >= MAX_SYMBOLS) return normalized;
  return [...normalized, sym];
}

/** Remove a symbol from the list. */
export function removeSymbol(symbols: string[], symbol: string): string[] {
  const target = normalizeSymbol(symbol);
  return normalizeStocksSettings({
    symbols: symbols.filter((s) => s !== target),
  }).symbols;
}

/** Move symbol up (-1) or down (+1) in the list. */
export function moveSymbol(symbols: string[], symbol: string, delta: -1 | 1): string[] {
  const list = normalizeStocksSettings({ symbols }).symbols;
  const target = normalizeSymbol(symbol);
  if (!target) return list;
  const i = list.indexOf(target);
  if (i < 0) return list;
  const j = i + delta;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  const tmp = next[i]!;
  next[i] = next[j]!;
  next[j] = tmp;
  return next;
}

/** Format price with currency-aware decimals. */
export function formatPrice(price: number, currency: string): string {
  const digits = price >= 1000 ? 2 : price >= 1 ? 2 : 4;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "USD",
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(price);
  } catch {
    return `${price.toFixed(digits)} ${currency || ""}`.trim();
  }
}

/** Format signed percent change. */
export function formatChangePercent(changePercent: number): string {
  const sign = changePercent > 0 ? "+" : "";
  return `${sign}${changePercent.toFixed(2)}%`;
}

/** Compact volume (e.g. 1.2M). */
export function formatVolume(volume: number | null): string {
  if (volume == null || !Number.isFinite(volume)) return "—";
  if (volume >= 1e9) return `${(volume / 1e9).toFixed(2)}B`;
  if (volume >= 1e6) return `${(volume / 1e6).toFixed(2)}M`;
  if (volume >= 1e3) return `${(volume / 1e3).toFixed(1)}K`;
  return String(Math.round(volume));
}

/** Build SVG polyline points for a sparkline in a fixed viewBox. */
export function sparklinePoints(
  values: number[],
  width = 120,
  height = 36,
  pad = 2,
): string {
  const nums = values.filter((v) => Number.isFinite(v));
  if (nums.length < 2) return "";
  let min = Math.min(...nums);
  let max = Math.max(...nums);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  return nums
    .map((v, i) => {
      const x = pad + (i / (nums.length - 1)) * innerW;
      const y = pad + (1 - (v - min) / (max - min)) * innerH;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

// --- Yahoo chart parsing ---

interface YahooMeta {
  currency?: string;
  symbol?: string;
  shortName?: string;
  longName?: string;
  regularMarketPrice?: number;
  previousClose?: number;
  chartPreviousClose?: number;
  regularMarketDayHigh?: number;
  regularMarketDayLow?: number;
  regularMarketVolume?: number;
}

interface YahooChartResult {
  meta?: YahooMeta;
  timestamp?: number[];
  indicators?: {
    quote?: Array<{
      close?: Array<number | null>;
      high?: Array<number | null>;
      low?: Array<number | null>;
      volume?: Array<number | null>;
    }>;
  };
}

interface YahooChartResponse {
  chart?: {
    result?: YahooChartResult[] | null;
    error?: { description?: string } | null;
  };
}

/** Pick a finite number from candidates. */
function firstFinite(...vals: Array<number | null | undefined>): number | null {
  for (const v of vals) {
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

/** Last finite value in a series. */
function lastFinite(series: Array<number | null> | undefined): number | null {
  if (!series?.length) return null;
  for (let i = series.length - 1; i >= 0; i--) {
    const v = series[i];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

/** Parse Yahoo chart JSON into a QuoteRow. */
export function parseYahooQuote(symbol: string, json: unknown): QuoteRow | null {
  const body = json as YahooChartResponse;
  const err = body.chart?.error?.description;
  if (err) return null;
  const result = body.chart?.result?.[0];
  if (!result?.meta) return null;
  const meta = result.meta;
  const closes = result.indicators?.quote?.[0]?.close;
  const price = firstFinite(meta.regularMarketPrice, lastFinite(closes));
  const previousClose = firstFinite(meta.previousClose, meta.chartPreviousClose);
  if (price == null || previousClose == null || previousClose === 0) return null;
  const changePercent = ((price - previousClose) / previousClose) * 100;
  return {
    symbol: (meta.symbol || symbol).toUpperCase(),
    name: meta.shortName || meta.longName || symbol,
    price,
    previousClose,
    changePercent,
    currency: meta.currency || "USD",
  };
}

/** Finite numbers from a Yahoo series (drops nulls). */
function finiteSeries(series: Array<number | null> | undefined): number[] {
  return (series ?? []).filter(
    (v): v is number => typeof v === "number" && Number.isFinite(v),
  );
}

/** Parse Yahoo chart JSON into QuoteDetail (includes sparkline). */
export function parseYahooDetail(symbol: string, json: unknown): QuoteDetail | null {
  const row = parseYahooQuote(symbol, json);
  if (!row) return null;
  const body = json as YahooChartResponse;
  const result = body.chart?.result?.[0];
  const meta = result?.meta;
  const quote = result?.indicators?.quote?.[0];
  const highs = finiteSeries(quote?.high);
  const lows = finiteSeries(quote?.low);
  const closes = finiteSeries(quote?.close);
  return {
    ...row,
    dayHigh: firstFinite(meta?.regularMarketDayHigh, highs.length ? Math.max(...highs) : null),
    dayLow: firstFinite(meta?.regularMarketDayLow, lows.length ? Math.min(...lows) : null),
    volume: firstFinite(meta?.regularMarketVolume, lastFinite(quote?.volume)),
    sparkline: closes,
  };
}

// --- TTL cache + Yahoo provider ---

interface CacheEntry<T> {
  at: number;
  value: T;
}

const quoteCache = new Map<string, CacheEntry<QuoteRow>>();
const detailCache = new Map<string, CacheEntry<QuoteDetail>>();

/** Clear in-memory quote/detail caches (tests / dispose). */
export function clearQuoteCaches(): void {
  quoteCache.clear();
  detailCache.clear();
}

/**
 * Fetch Yahoo chart JSON through the declared `chart` endpoint.
 *
 * The host owns the url, the browser-like User-Agent and the query1→query2
 * failover; it also rejects a symbol that is not a safe path segment.
 */
async function fetchYahooChart(
  http: HttpCapability,
  symbol: string,
  range: string,
  interval: string,
): Promise<unknown> {
  const encoded = encodeURIComponent(symbol.trim().toUpperCase());
  let lastError: unknown;
  for (const host of ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]) {
    try {
      return await http.get(`https://${host}/v8/finance/chart/${encoded}`, { range, interval });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("chart request failed");
}

/** Delay between symbol requests to soften burst traffic. */
function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Yahoo chart QuoteProvider with TTL cache. */
export function createYahooProvider(http: HttpCapability): QuoteProvider {
  return {
    async fetchQuotes(symbols, opts) {
      const bypass = opts?.bypassCache === true;
      const results: QuoteRowResult[] = [];
      for (let i = 0; i < symbols.length; i++) {
        const symbol = symbols[i]!;
        if (i > 0) await delay(80);
        const cached = quoteCache.get(symbol);
        if (!bypass && cached && Date.now() - cached.at < CACHE_TTL_MS) {
          results.push({ ok: true, data: cached.value });
          continue;
        }
        try {
          const json = await fetchYahooChart(http, symbol, "1d", "1d");
          const data = parseYahooQuote(symbol, json);
          if (!data) {
            results.push({ ok: false, symbol, error: "Quote unavailable" });
            continue;
          }
          quoteCache.set(symbol, { at: Date.now(), value: data });
          results.push({ ok: true, data });
        } catch {
          results.push({ ok: false, symbol, error: "Failed to load" });
        }
      }
      return results;
    },

    async fetchDetail(symbol, opts) {
      const bypass = opts?.bypassCache === true;
      const cached = detailCache.get(symbol);
      if (!bypass && cached && Date.now() - cached.at < CACHE_TTL_MS) {
        return { ok: true, data: cached.value };
      }
      try {
        const json = await fetchYahooChart(http, symbol, "5d", "1h");
        const data = parseYahooDetail(symbol, json);
        if (!data) return { ok: false, symbol, error: "Detail unavailable" };
        detailCache.set(symbol, { at: Date.now(), value: data });
        // Keep quote cache warm from detail.
        quoteCache.set(symbol, {
          at: Date.now(),
          value: {
            symbol: data.symbol,
            name: data.name,
            price: data.price,
            previousClose: data.previousClose,
            changePercent: data.changePercent,
            currency: data.currency,
          },
        });
        return { ok: true, data };
      } catch {
        return { ok: false, symbol, error: "Failed to load" };
      }
    },
  };
}
