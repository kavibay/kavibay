# Stocks Widget — Decision List (Tier M)

**Tier:** M — settings + watchlist state + non-trivial UI; no new Rust; no Settings nav  
**id / name / category:** `stocks` / **Stocks** / `information`  
**Reference:** `weather` (fetch + settings + poll) + `snapshots` (list → expand detail)

## Decisions

1. Compact watchlist of Yahoo Finance symbols; click a row to expand richer detail in the same widget.
2. Data via Yahoo chart API (no API key), proxied through Tauri `stocks_fetch_chart` (Yahoo blocks browser CORS / bare-client 429). Provider interface leaves room for Finnhub later; V1 ships Yahoo only.
3. Poll every 5 minutes + manual refresh. Detail/sparkline fetched only on expand.
4. In-memory TTL cache (~5 min) keyed by symbol+kind; manual refresh bypasses TTL once.
5. Cap watchlist at 8 symbols. Defaults: `AAPL`, `MSFT`, `GOOGL`, `BTC-USD`.
6. Persist per instance: `kavibay:stocks:{instanceId}` → `{ symbols }`. Expanded row is UI-only (not persisted).
7. Rust module `src-tauri/src/stocks/` fetches with a browser User-Agent; TS parses JSON.
8. Duplicate copies symbols only; dispose clears cache + storage.

## Files

| File | Responsibility |
|------|----------------|
| `src/extensions/stocks/manifest.json` | Catalog |
| `src/extensions/stocks/index.ts` | Module + seed/dispose |
| `src/extensions/stocks/stocksLogic.ts` | Types, normalize, Yahoo provider, TTL cache |
| `src/extensions/stocks/stocksLogic.assert.ts` | Pure helper checks |
| `src/extensions/stocks/useStocksSettings.ts` | Per-instance settings cache |
| `src/extensions/stocks/StocksWidget.vue` | List / expand / poll / refresh |
| `src/extensions/stocks/StocksSettings.vue` | Add/remove/move symbols |
| `src-tauri/src/stocks/mod.rs` | Yahoo chart HTTP proxy command |

## Out of scope (V1)

Finnhub credentials, portfolio/P&L, news, symbol search autocomplete, charts beyond sparkline, Settings app nav.
