/**
 * Quick checks for stocks helpers (run: npx tsx src/extensions/stocks/stocksLogic.assert.ts).
 */
import {
  addSymbol,
  formatChangePercent,
  formatVolume,
  moveSymbol,
  normalizeStocksSettings,
  normalizeSymbol,
  parseYahooDetail,
  parseYahooQuote,
  removeSymbol,
  sparklinePoints,
  MAX_SYMBOLS,
  DEFAULT_SYMBOLS,
  normalizeStocksConfig,
  serializeStocksSymbols,
} from "./stocksLogic";
import stocksExtension from "./extension";
import { stocksWidget } from "./widgets/stocks";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

assert(stocksExtension.name === "stocks", "the port keeps the stocks extension id");

const config = normalizeStocksConfig({ symbols: " aapl, AAPL, nvda, !!! " });
assert(config.symbols === "AAPL, NVDA", "config normalizes comma-separated symbols");
assert(
  serializeStocksSymbols(["aapl", "MSFT"]) === "AAPL, MSFT",
  "config serialization stays normalized",
);

let actionConfig = "AAPL";
stocksWidget.actions!["add-symbol"]({
  ctx: {
    instanceId: "stocks-assert",
    config: { symbols: actionConfig },
    data: {} as never,
  },
  args: { symbol: "NVDA" },
  setConfig: (values) => { actionConfig = String(values.symbols); },
});
assert(actionConfig === "AAPL, NVDA", "the palette action updates the watchlist config");

assert(normalizeSymbol(" aapl ") === "AAPL", "normalize Symbol");
assert(normalizeSymbol("BTC-USD") === "BTC-USD", "normalize crypto");
assert(normalizeSymbol("!!!") === null, "reject junk");

const empty = normalizeStocksSettings({});
assert(
  empty.symbols.join(",") === DEFAULT_SYMBOLS.join(","),
  "defaults when empty",
);

const capped = normalizeStocksSettings({
  symbols: ["a", "b", "c", "d", "e", "f", "g", "h", "i", "a"],
});
assert(capped.symbols.length === MAX_SYMBOLS, "cap at MAX_SYMBOLS");
assert(capped.symbols[0] === "A", "uppercase + dedupe");

let list: string[] = [...DEFAULT_SYMBOLS];
list = addSymbol(list, "nvda");
assert(list.includes("NVDA"), "add symbol");
list = removeSymbol(list, "NVDA");
assert(!list.includes("NVDA"), "remove symbol");

const moved = moveSymbol(["AAPL", "MSFT", "GOOGL"], "MSFT", -1);
assert(moved.join(",") === "MSFT,AAPL,GOOGL", "move up");

assert(formatChangePercent(1.234) === "+1.23%", "format +pct");
assert(formatChangePercent(-2) === "-2.00%", "format -pct");
assert(formatVolume(1_500_000) === "1.50M", "format volume");
assert(formatVolume(null) === "—", "format null volume");

const pts = sparklinePoints([1, 2, 3], 100, 20, 0);
assert(pts.split(" ").length === 3, "sparkline points count");

const yahooQuote = {
  chart: {
    result: [
      {
        meta: {
          currency: "USD",
          symbol: "AAPL",
          shortName: "Apple Inc.",
          regularMarketPrice: 200,
          previousClose: 100,
        },
        indicators: { quote: [{ close: [100, 200] }] },
      },
    ],
    error: null,
  },
};

const row = parseYahooQuote("AAPL", yahooQuote);
assert(row?.price === 200, "parse price");
assert(row?.changePercent === 100, "parse change %");

const yahooDetail = {
  chart: {
    result: [
      {
        meta: {
          currency: "USD",
          symbol: "AAPL",
          shortName: "Apple Inc.",
          regularMarketPrice: 200,
          previousClose: 100,
          regularMarketDayHigh: 210,
          regularMarketDayLow: 90,
          regularMarketVolume: 1_000_000,
        },
        indicators: {
          quote: [
            {
              close: [100, 150, 200],
              high: [110, 160, 210],
              low: [90, 140, 190],
              volume: [1, 2, 1_000_000],
            },
          ],
        },
      },
    ],
    error: null,
  },
};

const detail = parseYahooDetail("AAPL", yahooDetail);
assert(detail?.dayHigh === 210, "detail high");
assert(detail?.sparkline.length === 3, "detail sparkline");

console.log("stocksLogic.assert: ok");
