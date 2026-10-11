import { shallowRef } from "vue";
import type { HttpCapability } from "@sdk/contract/sdk";

/**
 * Exchange rates from Frankfurter (ECB reference rates, keyless).
 *
 * One request for the EUR table covers every pair: any conversion goes through
 * EUR. The table is module state so the palette and every calculator widget
 * share it, and a `shallowRef` so their computed results re-run once it lands.
 */
export const CURRENCY_HOST = "api.frankfurter.dev";
const LATEST_URL = `https://${CURRENCY_HOST}/v1/latest`;

/** Units per EUR keyed by ISO code, EUR included as 1. Empty until loaded. */
export const currencyRates = shallowRef<Record<string, number>>({});

// The ECB publishes once per working day; an hour keeps a long-running app current.
const MAX_AGE_MS = 60 * 60 * 1000;
const RETRY_MS = 60 * 1000;
let loadedAt = 0;
let inFlight: Promise<void> | null = null;

/** Symbols and names typed for a currency, lower-cased. ¥ is read as yen. */
export const CURRENCY_ALIASES: Record<string, string> = {
  $: "USD", "€": "EUR", "£": "GBP", "¥": "JPY",
  dollar: "USD", dollars: "USD", euro: "EUR", euros: "EUR",
};

/**
 * "100 usd", "123$ in €": the cue to fetch rates, early enough that the palette
 * knows "usd" before the target is typed. Other queries never touch the network.
 */
export function looksLikeCurrency(expression: string): boolean {
  const trimmed = expression.trim();
  return /[$€£¥]/.test(trimmed) || /^[\d(.,-][^a-z]*[a-z]{3}/i.test(trimmed);
}

export function loadCurrencyRates(http: HttpCapability): Promise<void> {
  if (inFlight) return inFlight;
  if (Date.now() - loadedAt < MAX_AGE_MS) return Promise.resolve();
  inFlight = http
    .get<{ rates?: Record<string, unknown> }>(LATEST_URL)
    .then((json) => {
      const rates: Record<string, number> = { EUR: 1 };
      for (const [code, rate] of Object.entries(json?.rates ?? {})) {
        if (typeof rate === "number" && rate > 0) rates[code] = rate;
      }
      currencyRates.value = rates;
      loadedAt = Date.now();
    })
    .catch(() => {
      // Offline: try again in a minute rather than on every keystroke.
      loadedAt = Date.now() - MAX_AGE_MS + RETRY_MS;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}
