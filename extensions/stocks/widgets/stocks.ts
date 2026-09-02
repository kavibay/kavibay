// SPDX-License-Identifier: MIT
import { computed, onScopeDispose, ref, type ComputedRef, type Ref } from "vue";
import {
  defineWidget,
  type WidgetActionContext,
  type WidgetContext,
} from "@sdk/contract/sdk";
import {
  POLL_MS,
  addSymbol,
  createYahooProvider,
  normalizeStocksConfig,
  normalizeStocksSettings,
  serializeStocksSymbols,
  sparklinePoints,
  type QuoteDetail,
  type QuoteRow,
  type StocksConfig,
} from "../stocksLogic";

export interface StocksRowState {
  symbol: string;
  quote: QuoteRow | null;
  error: string | null;
}

export interface StocksModel {
  rows: Ref<StocksRowState[]>;
  loading: Ref<boolean>;
  listError: Ref<string | null>;
  updatedLabel: ComputedRef<string>;
  expanded: Ref<string | null>;
  detail: Ref<QuoteDetail | null>;
  detailLoading: Ref<boolean>;
  detailError: Ref<string | null>;
  sparkPoints: ComputedRef<string>;
  sparkUp: ComputedRef<boolean>;
  onRowClick(symbol: string): void;
  refresh(): void;
}

/** Palette action; it also works before the target widget is mounted. */
export function runAddSymbolAction({
  ctx,
  args,
  setConfig,
}: WidgetActionContext<StocksConfig>): void {
  const current = normalizeStocksConfig(ctx.config);
  const before = normalizeStocksSettings({ symbols: current.symbols.split(",") }).symbols;
  const next = addSymbol(before, args.symbol ?? "");
  const changed = next.length !== before.length || next.some((symbol, i) => symbol !== before[i]);
  if (!changed) throw new Error("symbol is invalid, duplicated, or the watchlist is full");
  setConfig({ symbols: serializeStocksSymbols(next) });
}

export const stocksWidget = defineWidget<StocksConfig>({
  name: "stocks",
  displayName: "Stocks",
  description: "Watchlist with Yahoo quotes and expandable detail.",
  defaultSize: { w: 5, h: 3 },
  minSize: { w: 3, h: 2 },
  mode: "both",
  capabilities: {
    http: {
      hosts: ["query1.finance.yahoo.com", "query2.finance.yahoo.com"],
      methods: ["GET"],
    },
  },
  configuration: {
    symbols: {
      type: "string",
      label: "Watchlist symbols",
      default: "AAPL, MSFT, GOOGL, BTC-USD",
    },
  },
  actions: { "add-symbol": runAddSymbolAction },
  component: {
    setup(ctx: WidgetContext<StocksConfig>): StocksModel {
      const config = normalizeStocksConfig(ctx.config);
      const symbols = normalizeStocksSettings({ symbols: config.symbols.split(",") }).symbols;
      const provider = ctx.http ? createYahooProvider(ctx.http) : undefined;

      const rows = ref<StocksRowState[]>(
        symbols.map((symbol) => ({ symbol, quote: null, error: null })),
      );
      const loading = ref(false);
      const listError = ref<string | null>(null);
      const updatedAt = ref<number | null>(null);
      const expanded = ref<string | null>(null);
      const detail = ref<QuoteDetail | null>(null);
      const detailLoading = ref(false);
      const detailError = ref<string | null>(null);
      let loadSeq = 0;
      let detailSeq = 0;

      const sparkPoints = computed(() =>
        detail.value ? sparklinePoints(detail.value.sparkline) : "",
      );
      const sparkUp = computed(() =>
        detail.value ? detail.value.changePercent >= 0 : true,
      );
      const updatedLabel = computed(() => {
        if (updatedAt.value == null) return "";
        return new Date(updatedAt.value).toLocaleTimeString(undefined, {
          hour: "2-digit",
          minute: "2-digit",
        });
      });

      async function loadDetail(symbol: string, bypassCache = false): Promise<void> {
        const seq = ++detailSeq;
        detailLoading.value = true;
        detailError.value = null;
        if (!provider) {
          detailLoading.value = false;
          detailError.value = "Stocks HTTP capability unavailable";
          return;
        }
        const result = await provider.fetchDetail(symbol, { bypassCache });
        if (seq !== detailSeq || expanded.value !== symbol) return;
        detailLoading.value = false;
        if (result.ok) {
          detail.value = result.data;
        } else {
          detailError.value = result.error;
        }
      }

      async function loadQuotes(bypassCache = false): Promise<void> {
        const seq = ++loadSeq;
        loading.value = true;
        listError.value = null;
        const previous = new Map(rows.value.map((row) => [row.symbol, row]));
        rows.value = symbols.map(
          (symbol) => previous.get(symbol) ?? { symbol, quote: null, error: null },
        );

        if (!symbols.length) {
          loading.value = false;
          return;
        }
        if (!provider) {
          rows.value = symbols.map((symbol) => ({
            symbol,
            quote: previous.get(symbol)?.quote ?? null,
            error: "HTTP unavailable",
          }));
          listError.value = "Stocks HTTP capability unavailable";
          loading.value = false;
          return;
        }

        const results = await provider.fetchQuotes(symbols, { bypassCache });
        if (seq !== loadSeq) return;
        const bySymbol = new Map(results.map((result) => [
          result.ok ? result.data.symbol : result.symbol,
          result,
        ]));
        rows.value = symbols.map((symbol) => {
          const result = bySymbol.get(symbol);
          if (!result) return { symbol, quote: null, error: "Failed to load" };
          if (result.ok) return { symbol, quote: result.data, error: null };
          return { symbol, quote: previous.get(symbol)?.quote ?? null, error: result.error };
        });
        listError.value = results.length > 0 && results.every((result) => !result.ok)
          ? "Could not load quotes"
          : null;
        updatedAt.value = Date.now();
        loading.value = false;

        if (!expanded.value && symbols[0]) expanded.value = symbols[0];
        if (expanded.value) void loadDetail(expanded.value, bypassCache);
      }

      const onRowClick = (symbol: string) => {
        if (expanded.value === symbol) {
          expanded.value = null;
          detail.value = null;
          detailError.value = null;
          detailLoading.value = false;
          return;
        }
        expanded.value = symbol;
        detail.value = null;
        void loadDetail(symbol);
      };

      const refresh = () => {
        if (!loading.value) void loadQuotes(true);
      };

      const timer = setInterval(() => void loadQuotes(), POLL_MS);
      onScopeDispose(() => {
        clearInterval(timer);
        loadSeq += 1;
        detailSeq += 1;
      });

      void loadQuotes();

      return {
        rows,
        loading,
        listError,
        updatedLabel,
        expanded,
        detail,
        detailLoading,
        detailError,
        sparkPoints,
        sparkUp,
        onRowClick,
        refresh,
      };
    },
  },
});
