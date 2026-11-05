<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { SquareArrowOutUpRightIcon } from "@sdk/icons";
import { version } from "../../../src-tauri/tauri.conf.json";
import logo from "../../../src-tauri/icons/icon.svg";
import { t } from "../i18n/i18n";

const links = ["https://github.com/kavibay/kavibay", "https://www.kavibay.com"];
const linkError = ref("");

/** Mirrors `updater::Status` in src-tauri/src/updater.rs. */
type UpdateStatus =
  | { state: "unsupported" | "idle" | "checking" | "upToDate" }
  | { state: "downloading" | "ready"; version: string }
  | { state: "failed"; message: string };

const update = ref<UpdateStatus>({ state: "idle" });
const installError = ref("");
let unlistenUpdate: UnlistenFn | undefined;

function openLink(url: string) {
  linkError.value = "";
  invoke("launch_path", { path: url }).catch(() => {
    linkError.value = t("about.linkFailed");
  });
}

// Written into dist/ by scripts/licenses.mjs during `pnpm build`, so a dev
// server has none.
const licenses = ref("");
async function toggleLicenses() {
  if (licenses.value) {
    licenses.value = "";
    return;
  }
  const response = await fetch("/licenses.txt").catch(() => undefined);
  // The content type check: a dev server answers a missing file with index.html.
  licenses.value = response?.ok && response.headers.get("content-type")?.startsWith("text/plain")
    ? await response.text()
    : t("about.licenses.missing");
}

function installUpdate() {
  installError.value = "";
  // On success the app exits and the installer takes over.
  invoke("updater_install").catch((error) => {
    installError.value = t("about.update.installFailed", { error: String(error) });
  });
}

// Opening About is the check, as in a browser: the tray's "Check for Updates"
// and the palette's "Update Kavibay" both land here.
onMounted(async () => {
  unlistenUpdate = await listen<UpdateStatus>("updater:status", ({ payload }) => {
    update.value = payload;
  });
  update.value = await invoke<UpdateStatus>("updater_status");
  if (["idle", "upToDate", "failed"].includes(update.value.state)) void invoke("updater_check");
});
onUnmounted(() => unlistenUpdate?.());
</script>

<template>
  <Teleport to=".settings-sticky">
    <h2 class="about-title">{{ t("about.title") }}</h2>
  </Teleport>
  <div class="about">
    <img :src="logo" :alt="t('about.logo')" width="112" height="112" />
    <h3 class="about-name">Kavibay</h3>
    <p class="about-version">{{ t("about.version", { version }) }}</p>
    <div class="about-update" aria-live="polite">
      <template v-if="update.state === 'unsupported'">
        <span>{{ t("about.update.unsupported") }}</span>
        <button type="button" class="settings-btn" @click="openLink('https://github.com/kavibay/kavibay/releases/latest')">
          {{ t("about.update.getLatest") }}
        </button>
      </template>
      <span v-else-if="update.state === 'idle' || update.state === 'checking'">{{ t("about.update.checking") }}</span>
      <span v-else-if="update.state === 'downloading'">{{ t("about.update.downloading", { version: update.version }) }}</span>
      <span v-else-if="update.state === 'upToDate'">{{ t("about.update.upToDate") }}</span>
      <template v-else-if="update.state === 'ready'">
        <span>{{ t("about.update.ready", { version: update.version }) }}</span>
        <button type="button" class="settings-btn settings-btn--primary" @click="installUpdate">
          {{ t("about.update.restart") }}
        </button>
      </template>
      <template v-else-if="update.state === 'failed'">
        <span>{{ t("about.update.failed", { message: update.message }) }}</span>
        <button type="button" class="settings-btn" @click="invoke('updater_check')">{{ t("about.update.retry") }}</button>
      </template>
    </div>
    <p v-if="installError" class="settings-section-hint" role="alert">{{ installError }}</p>
    <a
      v-for="url in links"
      :key="url"
      class="about-link"
      :href="url"
      @click.prevent="openLink(url)"
    >
      {{ url.replace('https://', '') }}
      <SquareArrowOutUpRightIcon :size="14" />
    </a>
    <p v-if="linkError" class="settings-section-hint" role="alert">{{ linkError }}</p>
    <p class="about-legal">
      {{ t("about.legal") }}
    </p>
    <button type="button" class="settings-btn" :aria-expanded="!!licenses" @click="toggleLicenses">
      {{ licenses ? t("about.licenses.hide") : t("about.licenses.show") }}
    </button>
    <pre v-if="licenses" class="about-licenses" tabindex="0">{{ licenses }}</pre>
  </div>
</template>

<style scoped>
.about-title {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
}

.about {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 40px 0;
  text-align: center;
}

.about-name {
  margin: 0;
  font-size: 24px;
  font-weight: 600;
}

.about-version {
  margin: 0;
  color: rgba(var(--fg-rgb), 0.6);
  font-size: 14px;
}

.about-update {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  color: rgba(var(--fg-rgb), 0.75);
  font-size: 13px;
}

.about-link {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: rgba(var(--fg-rgb), 0.9);
  font-size: 13px;
  text-underline-offset: 4px;
  overflow-wrap: anywhere;
}

.about-legal {
  margin: 8px 0 0;
  color: rgba(var(--fg-rgb), 0.6);
  font-size: 12px;
}

.about-licenses {
  box-sizing: border-box;
  width: 100%;
  max-height: 320px;
  margin: 0;
  padding: 12px;
  overflow: auto;
  border-radius: 8px;
  background: rgba(var(--fg-rgb), 0.05);
  color: rgba(var(--fg-rgb), 0.8);
  font-size: 11px;
  text-align: left;
  white-space: pre-wrap;
}

.about-link:hover,
.about-link:focus-visible {
  color: rgb(var(--fg-rgb));
}
</style>
