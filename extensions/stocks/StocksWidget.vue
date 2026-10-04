<script setup lang="ts">
// SPDX-License-Identifier: MIT
import type { StocksModel } from "./widgets/stocks";
import { formatChangePercent, formatPrice, formatVolume } from "./stocksLogic";

const props = defineProps<{ model: StocksModel }>();
const {
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
  refresh: onRefresh,
} = props.model;
</script>

<template>
  <div class="stocks">
    <div class="stocks-toolbar" @pointerdown.stop>
      <span class="stocks-updated">
        <template v-if="updatedLabel">Updated {{ updatedLabel }}</template>
        <template v-else-if="loading">Loading…</template>
      </span>
      <button
        type="button"
        class="stocks-refresh"
        :class="{ 'stocks-refresh--spin': loading }"
        :disabled="loading"
        aria-label="Refresh"
        v-tip="'Refresh'"
        @click="onRefresh"
      >
        <svg
          viewBox="0 0 24 24"
          width="13"
          height="13"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M21 12a9 9 0 1 1-2.64-6.36" />
          <path d="M21 3v6h-6" />
        </svg>
      </button>
    </div>

    <p v-if="listError && !rows.some((r) => r.quote)" class="stocks-status stocks-status--error">
      {{ listError }}
    </p>

    <div v-else class="stocks-layout">
      <ul class="stocks-list">
        <li
          v-for="row in rows"
          :key="row.symbol"
          class="stocks-row"
          :class="{ 'stocks-row--open': expanded === row.symbol }"
        >
          <button type="button" class="stocks-row-btn" @click="onRowClick(row.symbol)">
            <span class="stocks-sym">{{ row.symbol }}</span>
            <span v-if="row.quote" class="stocks-price">
              {{ formatPrice(row.quote.price, row.quote.currency) }}
            </span>
            <span
              v-if="row.quote"
              class="stocks-chg"
              :class="row.quote.changePercent >= 0 ? 'stocks-chg--up' : 'stocks-chg--down'"
            >
              {{ formatChangePercent(row.quote.changePercent) }}
            </span>
            <span v-else-if="row.error" class="stocks-row-err">{{ row.error }}</span>
            <span v-else class="stocks-row-err">…</span>
          </button>
        </li>
      </ul>

      <section class="stocks-detail-panel" @pointerdown.stop>
        <p v-if="!expanded" class="stocks-empty">Select a ticker for its market detail.</p>
        <template v-else>
          <p v-if="detailLoading && !detail" class="stocks-status">Loading detail…</p>
          <p v-else-if="detailError && !detail" class="stocks-status stocks-status--error">
            {{ detailError }}
          </p>
          <template v-else-if="detail">
            <p class="stocks-name">{{ detail.name }}</p>
            <div class="stocks-metrics">
              <div>
                <span class="stocks-metric-label">Prev close</span>
                <span>{{ formatPrice(detail.previousClose, detail.currency) }}</span>
              </div>
              <div>
                <span class="stocks-metric-label">Day high</span>
                <span>
                  {{
                    detail.dayHigh != null
                      ? formatPrice(detail.dayHigh, detail.currency)
                      : "—"
                  }}
                </span>
              </div>
              <div>
                <span class="stocks-metric-label">Day low</span>
                <span>
                  {{
                    detail.dayLow != null
                      ? formatPrice(detail.dayLow, detail.currency)
                      : "—"
                  }}
                </span>
              </div>
              <div>
                <span class="stocks-metric-label">Volume</span>
                <span>{{ formatVolume(detail.volume) }}</span>
              </div>
            </div>
            <svg
              v-if="sparkPoints"
              class="stocks-spark"
              viewBox="0 0 120 36"
              width="100%"
              height="36"
              aria-hidden="true"
            >
              <polyline
                fill="none"
                :stroke="sparkUp ? 'rgba(120, 220, 160, 0.9)' : 'rgba(255, 120, 120, 0.9)'"
                stroke-width="1.5"
                stroke-linejoin="round"
                stroke-linecap="round"
                :points="sparkPoints"
              />
            </svg>
            <p v-if="detailError" class="stocks-status stocks-status--error stocks-status--inline">
              {{ detailError }}
            </p>
          </template>
        </template>
      </section>
    </div>
  </div>
</template>

<style scoped>
.stocks {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  container-type: inline-size;
}

.stocks-toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 8px;
}

.stocks-updated {
  font-size: 11px;
  color: rgba(var(--fg-rgb), 0.45);
}

.stocks-refresh {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: rgba(var(--fg-rgb), 0.4);
  cursor: pointer;
}

.stocks-refresh:hover:not(:disabled) {
  color: rgba(var(--fg-rgb), 0.9);
  background: rgba(var(--fg-rgb), 0.08);
}

.stocks-refresh:disabled {
  cursor: default;
  opacity: 0.7;
}

.stocks-refresh--spin svg {
  animation: stocks-spin 0.8s linear infinite;
}

@keyframes stocks-spin {
  to {
    transform: rotate(360deg);
  }
}

.stocks-status {
  margin: 0;
  font-size: 13px;
  color: rgba(var(--fg-rgb), 0.6);
}

.stocks-status--error {
  color: #ff8080;
}

.stocks-status--inline {
  margin-top: 6px;
}

.stocks-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.stocks-layout {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
}

.stocks-row {
  border-radius: 8px;
}

.stocks-row--open {
  background: rgba(var(--fg-rgb), 0.05);
}

.stocks-row-btn {
  display: grid;
  grid-template-columns: 1fr auto auto;
  align-items: center;
  gap: 8px;
  width: 100%;
  margin: 0;
  padding: 7px 8px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.stocks-row-btn:hover {
  background: rgba(var(--fg-rgb), 0.06);
}

.stocks-sym {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: rgba(var(--fg-rgb), 0.92);
}

.stocks-price {
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  color: rgba(var(--fg-rgb), 0.85);
}

.stocks-chg {
  min-width: 62px;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.stocks-chg--up {
  color: rgba(120, 220, 160, 0.95);
}

.stocks-chg--down {
  color: rgba(255, 130, 130, 0.95);
}

.stocks-row-err {
  grid-column: 2 / -1;
  font-size: 12px;
  color: rgba(var(--fg-rgb), 0.4);
  text-align: right;
}

.stocks-detail-panel {
  min-width: 0;
  min-height: 0;
  padding: 12px 10px 10px;
}

.stocks-empty {
  margin: 0;
  color: rgba(var(--fg-rgb), 0.42);
  font-size: 12px;
  line-height: 1.4;
}

.stocks-name {
  margin: 0 0 10px;
  font-size: 13px;
  font-weight: 600;
  color: rgba(var(--fg-rgb), 0.85);
}

.stocks-metrics {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px 12px;
  margin-bottom: 8px;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: rgba(var(--fg-rgb), 0.85);
}

.stocks-metrics > div {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.stocks-metric-label {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: rgba(var(--fg-rgb), 0.4);
}

.stocks-spark {
  display: block;
  margin-top: 2px;
  opacity: 0.95;
}

@container (min-width: 500px) {
  .stocks-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    overflow: hidden;
    border: 1px solid rgba(var(--fg-rgb), 0.08);
    border-radius: 12px;
    background: rgba(0, 0, 0, 0.1);
  }

  .stocks-list {
    min-height: 0;
    padding: 6px;
    overflow-y: auto;
    border-right: 1px solid rgba(var(--fg-rgb), 0.09);
  }

  .stocks-detail-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: 12px 14px;
    box-sizing: border-box;
    background: rgba(var(--fg-rgb), 0.025);
  }

  .stocks-spark {
    height: 72px;
    margin-top: auto;
  }
}
</style>
