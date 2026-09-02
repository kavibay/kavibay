<script setup lang="ts">
import { computed } from "vue";
import {
  batteryAccent,
  formatMemoryGb,
  formatUptime,
  memoryUsagePercent,
  roundPercent,
  visibleHeroKeys,
} from "./systemInfoLogic";
import type { SystemInfoModel } from "./widgets/systemInfo";

const props = defineProps<{ model: SystemInfoModel }>();
const { settings, data, loading, error } = props.model;

/** Hero tile keys currently enabled, omitting battery when the host has none. */
const heroKeys = computed(() => {
  if (!data.value) return [];
  return visibleHeroKeys(settings, data.value.battery != null);
});

/** Inline grid-template-columns so the hero row always splits evenly across N tiles. */
const heroGridStyle = computed(() => ({
  gridTemplateColumns: `repeat(${heroKeys.value.length}, 1fr)`,
}));

/** Rounded CPU load percentage for the hero tile. */
const cpuPercent = computed(() => roundPercent(data.value?.cpu_usage_percent ?? 0));

/** Rounded memory usage percentage for the hero tile. */
const memPercent = computed(() =>
  memoryUsagePercent(data.value?.used_memory_mb ?? 0, data.value?.total_memory_mb ?? 0),
);

/** Rounded battery charge percentage for the hero tile (0 when battery is absent). */
const batteryPercent = computed(() => roundPercent(data.value?.battery?.percent ?? 0));

/** Battery tile accent color, matching state/percent thresholds from systemInfoLogic. */
const batteryColor = computed(() => {
  const battery = data.value?.battery;
  if (!battery) return "#fbbf24";
  const accent = batteryAccent(battery.state, roundPercent(battery.percent));
  return { green: "#6ee7b7", amber: "#fbbf24", red: "#f87171" }[accent];
});

/** "brand · N cores" summary for the CPU detail row. */
const cpuDetailLabel = computed(() => {
  if (!data.value) return "";
  return `${data.value.cpu_brand} · ${data.value.cpu_count} cores`;
});

/** Used/total memory formatted in GB for the memory detail row. */
const memoryDetailLabel = computed(() => {
  if (!data.value) return "";
  return formatMemoryGb(data.value.used_memory_mb, data.value.total_memory_mb);
});

/** Total uptime formatted as "Xh Ym" for the uptime detail row. */
const uptimeLabel = computed(() => formatUptime(data.value?.uptime_secs ?? 0));
</script>

<template>
  <div class="system-info">
    <p v-if="loading && !data" class="system-info-status">Loading…</p>
    <p v-else-if="error && !data" class="system-info-status system-info-status--error">
      {{ error }}
    </p>
    <template v-else-if="data">
      <div v-if="heroKeys.length > 0" class="hero-grid" :style="heroGridStyle">
        <div v-for="key in heroKeys" :key="key" class="hero-tile" :class="`hero-tile--${key}`">
          <template v-if="key === 'cpu'">
            <span class="hero-value hero-value--cpu">{{ cpuPercent }}%</span>
            <span class="hero-label">CPU</span>
          </template>
          <template v-else-if="key === 'memory'">
            <span class="hero-value hero-value--memory">{{ memPercent }}%</span>
            <span class="hero-label">RAM</span>
          </template>
          <template v-else-if="key === 'battery'">
            <span class="hero-value" :style="{ color: batteryColor }">
              <span
                class="battery-glyph"
                aria-hidden="true"
                :style="{ '--batt-fill': batteryPercent, color: batteryColor }"
              ></span>
              {{ batteryPercent }}%
            </span>
            <span class="hero-label">Batt</span>
          </template>
        </div>
      </div>

      <dl v-if="settings.showOs || settings.showCpu || settings.showMemory || settings.showUptime" class="detail-grid">
        <template v-if="settings.showOs">
          <dt>OS</dt>
          <dd>{{ data.os_name }} {{ data.os_version }}</dd>
          <dt>Host</dt>
          <dd>{{ data.hostname }}</dd>
        </template>
        <template v-if="settings.showCpu">
          <dt>CPU</dt>
          <dd>{{ cpuDetailLabel }}</dd>
        </template>
        <template v-if="settings.showMemory">
          <dt>RAM</dt>
          <dd>{{ memoryDetailLabel }}</dd>
        </template>
        <template v-if="settings.showUptime">
          <dt>Uptime</dt>
          <dd>{{ uptimeLabel }}</dd>
        </template>
      </dl>
    </template>
  </div>
</template>

<style scoped>
.system-info {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 14px;
  container-type: inline-size;
}

.system-info-status {
  margin: 0;
  font-size: 13px;
  color: rgba(var(--fg-rgb), 0.6);
}

.system-info-status--error {
  color: #ff8080;
}

.hero-grid {
  display: grid;
  gap: 10px;
}

.hero-tile {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  padding: 14px;
  border-radius: 10px;
  background: linear-gradient(135deg, rgba(var(--fg-rgb), 0.09), rgba(var(--fg-rgb), 0.035));
  border: 1px solid rgba(var(--fg-rgb), 0.08);
}

.hero-value {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 24px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

.hero-value--cpu {
  color: #6ee7b7;
}

.hero-value--memory {
  color: #93c5fd;
}

.hero-label {
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: rgba(var(--fg-rgb), 0.5);
}

/* Mini battery glyph: outer body via border, nub via ::after, charge fill via ::before. */
.battery-glyph {
  position: relative;
  display: inline-block;
  width: 15px;
  height: 8px;
  border: 1.5px solid currentColor;
  border-radius: 2px;
  box-sizing: border-box;
}

.battery-glyph::before {
  content: "";
  position: absolute;
  top: 1px;
  left: 1px;
  bottom: 1px;
  width: calc((100% - 2px) * var(--batt-fill, 0) / 100);
  background: currentColor;
  border-radius: 1px;
}

.battery-glyph::after {
  content: "";
  position: absolute;
  top: 50%;
  right: -3px;
  transform: translateY(-50%);
  width: 2px;
  height: 4px;
  background: currentColor;
  border-radius: 0 1px 1px 0;
}

.detail-grid {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 8px 12px;
  margin: 0;
  padding-top: 14px;
  border-top: 1px solid rgba(var(--fg-rgb), 0.08);
  font-size: 13px;
}

.detail-grid dt {
  color: rgba(var(--fg-rgb), 0.5);
}

.detail-grid dd {
  margin: 0;
  text-align: right;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

@container (min-width: 500px) {
  .detail-grid {
    grid-template-columns: auto minmax(0, 1fr) auto minmax(0, 1fr);
    gap: 12px 14px;
  }

  .detail-grid dd {
    text-align: left;
  }
}
</style>
