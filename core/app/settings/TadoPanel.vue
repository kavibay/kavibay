<script setup lang="ts">
/**
 * App Settings → Tado: "Add all rooms", which creates one widget instance per
 * heating zone that isn't bound yet.
 *
 * The account itself lives in Settings → Credentials; this panel only shows
 * the connect state so the room actions make sense in context.
 * Settings sits inside WidgetHost's overlay slot, so the host's
 * kavibayAddWidget / kavibayWidgetInstances provides are available here.
 */
import { inject, onMounted, ref } from "vue";
import type { WidgetInstance } from "../host/types";
import { extensionHost, instanceConfig, updateInstanceConfig } from "../extension-host/cockpit";
import { BrandMark } from "@sdk/brand";

/**
 * Ported to the contract along with the widget itself. Two things went away
 * rather than being rewritten: the account panel, because sign-in belongs to
 * Settings → Credentials and always did, and the `tado_list_zones` command,
 * because the provider already declares that query and the broker attaches the
 * auth. What is left is the part that is actually this panel's own: adding a
 * tile per room.
 */
interface TadoZoneInfo {
  id: number;
  name: string;
}

const TADO_PROVIDER = "kavibay.tado/tado";
const TADO_TYPE_ID = "tado";

const instances = inject<WidgetInstance[]>("kavibayWidgetInstances");
const addWidget = inject<(typeId: string) => string | undefined>("kavibayAddWidget");

const connected = ref(false);
const addingAll = ref(false);
const addAllFeedback = ref<string | null>(null);

onMounted(async () => {
  await extensionHost.refreshProviderStatus(TADO_PROVIDER);
  connected.value = extensionHost.providerStatus(TADO_PROVIDER).state === "connected";
});

/** Existing Tado instance ids: prefer the live host provide, else parse the persisted layout. */
function getTadoInstanceIds(): string[] {
  if (instances) {
    return instances
      .filter((instance) => instance.typeId === "tado")
      .map((instance) => instance.instanceId);
  }
  try {
    const raw = JSON.parse(localStorage.getItem("kavibay:layout-v3") ?? "null");
    const rawInstances: unknown[] = Array.isArray(raw?.instances) ? raw.instances : [];
    return rawInstances
      .filter(
        (item: unknown): item is { instanceId: string } =>
          Boolean(item) &&
          typeof item === "object" &&
          (item as Record<string, unknown>).typeId === TADO_TYPE_ID &&
          typeof (item as Record<string, unknown>).instanceId === "string",
      )
      .map((item) => item.instanceId);
  } catch {
    return [];
  }
}

/** Zones already bound by an existing tile, read from the shared config. */
function boundZoneIds(): Set<string> {
  return new Set(
    getTadoInstanceIds()
      .map((id) => instanceConfig(id).zone)
      .filter((zone): zone is string | number => zone != null)
      .map(String),
  );
}

/** Add one widget per heating zone that doesn't already have a bound instance. */
async function onAddAll() {
  if (!addWidget) {
    addAllFeedback.value = "Unable to add widgets from Settings.";
    return;
  }
  addingAll.value = true;
  addAllFeedback.value = null;
  try {
    // The provider's own query, through the broker — no separate command and
    // no second place that knows the tado° endpoint.
    const allZones = await extensionHost.query<TadoZoneInfo[]>(TADO_PROVIDER, "zones", {}, null);
    const bound = boundZoneIds();
    const toAdd = (Array.isArray(allZones) ? allZones : []).filter(
      (zone) => !bound.has(String(zone.id)),
    );

    let added = 0;
    for (const zone of toAdd) {
      const id = addWidget(TADO_TYPE_ID);
      if (id) {
        updateInstanceConfig(id, { zone: zone.id });
        added += 1;
      }
    }
    addAllFeedback.value =
      added > 0 ? `Added ${added} room${added === 1 ? "" : "s"}.` : "All rooms already added.";
  } catch (error) {
    addAllFeedback.value = `Could not load rooms: ${String(error)}`;
  } finally {
    addingAll.value = false;
  }
}
</script>

<template>
  <div class="tado-panel">
    <div class="tado-panel-head">
      <BrandMark :provider="TADO_PROVIDER" :size="22" />
      <h2 class="tado-panel-title">Tado</h2>
    </div>
    <p class="tado-panel-sub">
      Add room thermostats. Manage the account itself under Settings → Credentials.
    </p>

    <p v-if="!connected" class="tado-panel-sub">
      Not connected yet — sign in under Settings → Credentials, then come back.
    </p>

    <div v-if="connected" class="tado-panel-section">
      <h3 class="tado-panel-section-title">Rooms</h3>
      <p class="tado-panel-sub">Add a tile for every heating zone that isn't on screen yet.</p>
      <button
        type="button"
        class="tado-panel-add-all"
        :disabled="addingAll"
        @click="onAddAll"
      >
        {{ addingAll ? "Adding…" : "Add all rooms" }}
      </button>
      <p v-if="addAllFeedback" class="tado-panel-feedback">{{ addAllFeedback }}</p>
    </div>
  </div>
</template>

<style scoped>
.tado-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.tado-panel-head {
  display: flex;
  align-items: center;
  gap: 9px;
}

.tado-panel-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: rgba(var(--fg-rgb), 0.95);
}

.tado-panel-sub {
  margin: 0;
  font-size: 13px;
  color: rgba(var(--fg-rgb), 0.5);
}

.tado-panel-section {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
  margin-top: 8px;
  padding: 14px 16px;
  border-radius: 12px;
  border: 1px solid rgba(var(--fg-rgb), 0.1);
  background: rgba(var(--fg-rgb), 0.04);
}

.tado-panel-section-title {
  margin: 0;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgba(var(--fg-rgb), 0.4);
}

.tado-panel-add-all {
  padding: 8px 14px;
  border-radius: 8px;
  border: 1px solid rgba(var(--fg-rgb), 0.16);
  background: rgba(var(--fg-rgb), 0.08);
  color: rgba(var(--fg-rgb), 0.92);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.tado-panel-add-all:hover {
  background: rgba(var(--fg-rgb), 0.14);
}

.tado-panel-add-all:disabled {
  opacity: 0.6;
  cursor: default;
}

.tado-panel-feedback {
  margin: 0;
  font-size: 12px;
  color: rgba(var(--fg-rgb), 0.6);
}
</style>
