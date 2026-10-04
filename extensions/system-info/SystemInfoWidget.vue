<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import {
  batteryAccent,
  EXTENDED_MIN_HEIGHT,
  formatBytes,
  formatCpuShare,
  formatMemoryGb,
  formatUptime,
  memoryUsagePercent,
  roundPercent,
  sparklinePoints,
  visibleHeroKeys,
} from "./systemInfoLogic";
import { HISTORY_SLOTS, type SystemInfoModel } from "./widgets/systemInfo";

const props = defineProps<{ model: SystemInfoModel }>();
const { settings, data, loading, error, history, network, extended } = props.model;

/** The large view follows the widget's height: drag it taller to see more. */
const root = ref<HTMLElement | null>(null);
let resizeObserver: ResizeObserver | undefined;
onMounted(() => {
  resizeObserver = new ResizeObserver(([entry]) => {
    props.model.setExtended(entry.contentRect.height >= EXTENDED_MIN_HEIGHT);
  });
  if (root.value) resizeObserver.observe(root.value);
});
onUnmounted(() => resizeObserver?.disconnect());

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

const sparkViewBox = `0 0 ${HISTORY_SLOTS - 1} 100`;
const showSparklines = computed(
  () => extended.value && settings.showHistory && history.value.length > 1,
);
const cpuSpark = computed(() =>
  sparklinePoints(history.value.map((sample) => sample.cpu), HISTORY_SLOTS),
);
const memorySpark = computed(() =>
  sparklinePoints(history.value.map((sample) => sample.memory), HISTORY_SLOTS),
);

/** Disks with their used share, for the bar and the label. */
const disks = computed(() =>
  (data.value?.disks ?? []).map((disk) => {
    const used = disk.total_bytes - disk.available_bytes;
    return {
      mount: disk.mount,
      percent: roundPercent((used / disk.total_bytes) * 100),
      label: `${formatBytes(used)} / ${formatBytes(disk.total_bytes)}`,
    };
  }),
);
</script>

<template>
  <div ref="root" class="system-info" :class="{ 'system-info--extended': extended }">
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
            <svg
              v-if="showSparklines"
              class="sparkline sparkline--cpu"
              :viewBox="sparkViewBox"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <polyline :points="cpuSpark" />
            </svg>
          </template>
          <template v-else-if="key === 'memory'">
            <span class="hero-value hero-value--memory">{{ memPercent }}%</span>
            <span class="hero-label">RAM</span>
            <svg
              v-if="showSparklines"
              class="sparkline sparkline--memory"
              :viewBox="sparkViewBox"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <polyline :points="memorySpark" />
            </svg>
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

      <template v-if="extended">
        <section v-if="settings.showNetwork" class="extra">
          <h3 class="extra-title">Network</h3>
          <p v-if="network" class="network-rates">
            <span>↓ {{ formatBytes(network.down) }}/s</span>
            <span>↑ {{ formatBytes(network.up) }}/s</span>
          </p>
          <p v-else class="extra-empty">Measuring…</p>
        </section>

        <section v-if="settings.showDisks && disks.length > 0" class="extra">
          <h3 class="extra-title">Disks</h3>
          <div v-for="disk in disks" :key="disk.mount" class="disk-row">
            <span class="disk-mount">{{ disk.mount }}</span>
            <span
              class="disk-bar"
              role="meter"
              :aria-label="`${disk.mount} used`"
              :aria-valuenow="disk.percent"
              aria-valuemin="0"
              aria-valuemax="100"
            >
              <span class="disk-fill" :style="{ width: `${disk.percent}%` }"></span>
            </span>
            <span class="disk-label">{{ disk.label }}</span>
          </div>
        </section>

        <section v-if="settings.showProcesses" class="extra">
          <h3 class="extra-title">Top processes</h3>
          <p v-if="!data.processes?.length" class="extra-empty">Measuring…</p>
          <div v-for="proc in data.processes ?? []" :key="proc.name" class="process-row">
            <span class="process-name">
              {{ proc.name }}<span v-if="proc.count > 1" class="process-count"> ×{{ proc.count }}</span>
            </span>
            <span class="process-cpu">{{ formatCpuShare(proc.cpu_percent) }}</span>
            <span class="process-memory">{{ formatBytes(proc.memory_bytes) }}</span>
          </div>
        </section>
      </template>
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

.system-info--extended {
  overflow-y: auto;
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
  min-width: 0;
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

.sparkline {
  width: 100%;
  height: 28px;
  margin-top: 4px;
  overflow: visible;
}

.sparkline polyline {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linejoin: round;
  vector-effect: non-scaling-stroke;
}

.sparkline--cpu {
  color: #6ee7b7;
}

.sparkline--memory {
  color: #93c5fd;
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

.extra {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 14px;
  border-top: 1px solid rgba(var(--fg-rgb), 0.08);
  font-size: 13px;
}

.extra-title {
  margin: 0;
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: rgba(var(--fg-rgb), 0.5);
}

.extra-empty {
  margin: 0;
  color: rgba(var(--fg-rgb), 0.5);
}

.network-rates {
  display: flex;
  gap: 18px;
  margin: 0;
  font-variant-numeric: tabular-nums;
}

.disk-row {
  display: grid;
  grid-template-columns: 2.5em minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
}

.disk-mount {
  color: rgba(var(--fg-rgb), 0.5);
}

.disk-bar {
  height: 6px;
  border-radius: 3px;
  background: rgba(var(--fg-rgb), 0.1);
  overflow: hidden;
}

.disk-fill {
  display: block;
  height: 100%;
  border-radius: 3px;
  background: #c4b5fd;
}

.process-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 4.5em 5em;
  gap: 10px;
}

.process-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.process-count {
  color: rgba(var(--fg-rgb), 0.45);
}

.disk-label,
.process-cpu,
.process-memory {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.process-cpu,
.process-memory {
  text-align: right;
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
