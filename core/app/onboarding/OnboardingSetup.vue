<script setup lang="ts">
/**
 * The first thing anybody ever sees: the greeting, the setup questions,
 * which AI to use, and how to start the tour — three pages of one card.
 *
 * They were once two screens — a welcome bubble, then a form — which is one
 * click and one full redraw to say a thing that fits in a paragraph. Worse, the
 * welcome arrived over an open search field and a desk of cards, so the moment
 * meant to introduce the app was also its busiest. Now nothing else is on
 * screen until this is answered: no palette, no widgets, no coach.
 *
 * Page 1 asks about the machine: autostart, and which display when there is a
 * choice. Page 2 asks which AI provider to use, with the same connection form
 * Settings → AI shows (`CredentialAccounts`), and is optional — not connecting
 * anything is an answer. Page 3 is the double tap that starts the tour: a
 * topic of its own, and the page that closes the card. Pressed earlier, the
 * gesture only turns the page (`nextSetupPage`), so nobody skips a question
 * unseen.
 *
 * The answers commit differently, on purpose. The display choice is an
 * ordinary preference and is written the moment it is clicked, exactly as the
 * same control does in Settings. Autostart writes *outside* the app — a
 * registry entry, a file in the user's config directory — so it is presented
 * pre-selected and written when page 1 is left: the user sees what will happen
 * before anything happens. A connection is saved by its own form, as in
 * Settings.
 */
import { computed, onMounted, onScopeDispose, ref, watch } from "vue";
import { availableMonitors } from "@tauri-apps/api/window";
import { holdHostDismiss } from "@sdk";
import { BrandMark } from "@sdk/brand";
import logo from "../../../src-tauri/icons/icon.svg";
import { t } from "../i18n/i18n";
import { syncInteractiveRegions } from "../system/clickThrough";
import { openMonitorOptions, type OpenMonitor } from "../settings/appearanceLogic";
import { useAppearance } from "../settings/useAppearance";
import { listLlmCatalog, type LlmModelOption } from "../settings/ai/aiApi";
import {
  AI_PROVIDER_TABS,
  credentialTypeForProvider,
  providerHasKey,
  type AiProviderTab,
} from "../settings/ai/aiPanelLogic";
import CredentialAccounts from "../settings/credentials/CredentialAccounts.vue";
import {
  listCredentials,
  listCredentialTypes,
  type CredentialSummary,
  type CredentialTypeSchema,
} from "../settings/credentials/credentialsApi";
import { revealGesture } from "../host/revealGesture";
import { doubleTapKeyLabel, keyPlatform } from "../host/shortcutHints";
import { onboardingRevealHintCopy, waitingPlace } from "./onboardingCopy";
import {
  isSetupVisible,
  nextSetupPage,
  SETUP_PAGES,
  setupQuestionCount,
  shouldOfferDisplayChoice,
  type SetupPage,
} from "./setupLogic";
import {
  finishSetup,
  setupAnsweredByGesture,
  setupGestureCount,
  setupState,
} from "./setupSession";
import { useAutostart } from "./useAutostart";
import { useOnboarding } from "./useOnboarding";

type ProviderId = AiProviderTab["id"];

const { openMonitor, setOpenMonitor } = useAppearance();
const { supported: autostartSupported, error: autostartError, setEnabled } = useAutostart();
const { declineTour } = useOnboarding();

const visible = computed(() => isSetupVisible(setupState.value));

/** Session-only: a restart while the card is pending starts again on page 1. */
const page = ref<SetupPage>("machine");
/** The provider whose connection form replaces the list, or null for the list. */
const connecting = ref<ProviderId | null>(null);

/**
 * What leaving page 1 will write. Starts on because a launcher the user has to
 * remember to start is one they stop using after the first reboot — but it is a
 * visible default they can decline, not a decision made for them.
 */
const wantsAutostart = ref(true);

/** How many displays the machine reports; 1 until the host answers. */
const monitorCount = ref(1);
const offerDisplayChoice = computed(() => shouldOfferDisplayChoice(monitorCount.value));

/**
 * How to reach Kavibay, in the words this machine can honour.
 *
 * The card states it rather than teaching it — the tour's second step does the
 * teaching — because this is the only screen everybody sees, including the
 * people who skip the tour.
 */
const platform = keyPlatform();
const doubleTapKey = doubleTapKeyLabel(platform);
const openMonitors = openMonitorOptions(platform);
const revealHint = computed(() => onboardingRevealHintCopy(revealGesture.value, platform));
/** The double tap is a gesture the card can ask for, so it becomes the way in. */
const asksForDoubleTap = computed(() => revealGesture.value === "ctrlDoubleTap");

// Neither Escape nor a click beside the card may close it: the window would
// hide with the question unanswered, and a new user has no way back yet.
let releaseDismiss: (() => void) | null = null;
watch(
  visible,
  (shown) => {
    if (shown && !releaseDismiss) releaseDismiss = holdHostDismiss("onboarding setup card");
    else if (!shown && releaseDismiss) {
      releaseDismiss();
      releaseDismiss = null;
    }
  },
  { immediate: true },
);
onScopeDispose(() => releaseDismiss?.());

// The host hands over the reveal gesture while the card is up; see `setupGestureCount`.
watch(setupGestureCount, () => {
  if (!visible.value) return;
  if (page.value === "machine") void leaveMachinePage();
  else if (page.value === "ai") leaveAiPage();
  else {
    setupAnsweredByGesture.value = true;
    void onContinue();
  }
});

/** Counts what the card actually asks on this machine. */
const lead = computed(() =>
  t("onboarding.setup.lead", {
    count: setupQuestionCount({
      autostart: autostartSupported.value,
      displayChoice: offerDisplayChoice.value,
    }),
  }),
);

const busy = ref(false);

/** 1-based position for the dots' label. */
const pageNumber = computed(() => SETUP_PAGES.indexOf(page.value) + 1);

// AI page data: loaded once the page is reached, reloaded after every change a
// connection form reports — the same three lists Settings → AI reads.
const models = ref<LlmModelOption[]>([]);
const types = ref<CredentialTypeSchema[]>([]);
const credentials = ref<CredentialSummary[]>([]);
const aiLoaded = ref(false);
const aiLoadError = ref(false);

async function loadAi() {
  try {
    const [loadedModels, loadedTypes, loadedCredentials] = await Promise.all([
      listLlmCatalog(),
      listCredentialTypes(),
      listCredentials(),
    ]);
    models.value = loadedModels;
    types.value = loadedTypes;
    credentials.value = loadedCredentials;
    aiLoadError.value = false;
  } catch {
    // Not a reason to hold anybody here: the tour runs without AI, and
    // Settings → AI is where a connection can be made later.
    aiLoadError.value = true;
  }
  aiLoaded.value = true;
}

/** The connection form reported a change; back to the list once it worked. */
async function onConnectionChanged() {
  await loadAi();
  if (connecting.value && providerHasKey(models.value, connecting.value)) {
    connecting.value = null;
  }
}

function credentialTypeOf(provider: ProviderId): CredentialTypeSchema | null {
  const typeId = credentialTypeForProvider(models.value, provider);
  return types.value.find((type) => type.id === typeId) ?? null;
}

const connectingTab = computed(
  () => AI_PROVIDER_TABS.find((tab) => tab.id === connecting.value) ?? null,
);

onMounted(async () => {
  // The card is click-through until the host is told which pixels are ours.
  void syncInteractiveRegions();
  try {
    monitorCount.value = (await availableMonitors()).length;
  } catch {
    // No answer means no second screen worth asking about; the preference is
    // still in Settings for the day one appears.
  }
  // A second row of buttons changes the card's height, so re-measure.
  void syncInteractiveRegions();
});

// Every page or view switch changes the card's height.
watch([page, connecting, aiLoaded], () => void syncInteractiveRegions(), { flush: "post" });

/** Pick which display the double tap covers. Persists immediately. */
function onOpenMonitor(target: OpenMonitor) {
  setOpenMonitor(target);
}

/**
 * Commit the autostart choice and turn to the AI page.
 *
 * A refused write is not a reason to keep the user here: `useAutostart` puts
 * the reason next to the switch in Settings, and the entry is not something the
 * rest of onboarding depends on.
 */
async function leaveMachinePage() {
  if (busy.value || page.value !== "machine") return;
  busy.value = true;
  if (autostartSupported.value) {
    await setEnabled(wantsAutostart.value);
  }
  busy.value = false;
  page.value = "ai";
  void loadAi();
}

/** On to the last page; a half-filled connection form is left behind unsaved. */
function leaveAiPage() {
  connecting.value = null;
  const next = nextSetupPage(page.value);
  if (next !== "finish") page.value = next;
}

/**
 * Close the card and start the tour.
 *
 * What happens next — the desk, the palette, the tour — is the host's to
 * sequence: it watches `setupState` and reveals them in one place. This card is
 * a form and stops at being one.
 */
async function onContinue() {
  await commit();
}

/** Same answers, no tour. */
async function onSkipTour() {
  await commit({ tour: false });
}

async function commit(opts: { tour?: boolean } = {}) {
  if (busy.value) return;
  busy.value = true;
  // Recorded before the card closes: the host watches `setupState` and reveals
  // the desk when it flips, so anything that must be decided first — including
  // whether there is a tour to reveal into — belongs on this side of it.
  if (opts.tour === false) declineTour();
  finishSetup();
  void syncInteractiveRegions();
}
</script>

<template>
  <div v-if="visible" class="setup" aria-live="polite">
    <div
      class="setup-card"
      data-interactive
      role="dialog"
      :aria-label="t('onboarding.setup.ariaLabel')"
    >
      <div
        class="setup-dots"
        role="img"
        :aria-label="t('onboarding.setup.pages', { current: pageNumber, total: SETUP_PAGES.length })"
      >
        <span
          v-for="p in SETUP_PAGES"
          :key="p"
          class="setup-dot"
          :class="{ 'setup-dot--active': page === p }"
        />
      </div>

      <template v-if="page === 'machine'">
        <div class="setup-head">
          <img class="setup-logo" :src="logo" alt="" width="40" height="40" />
          <p class="setup-title">{{ t("onboarding.setup.title") }}</p>
        </div>
        <p class="setup-lead">{{ lead }}</p>

        <label v-if="autostartSupported" class="toggle">
          <span class="toggle-copy">
            <span class="toggle-title">{{ t("onboarding.setup.autostart.title") }}</span>
            <span class="toggle-hint">
              {{ t("onboarding.setup.autostart.hint", { place: waitingPlace(platform) }) }}
            </span>
          </span>
          <span class="switch">
            <input type="checkbox" v-model="wantsAutostart" />
            <span class="switch-ui" />
          </span>
        </label>

        <section v-if="offerDisplayChoice" class="setup-block">
          <p class="setup-block-title">{{ t("onboarding.setup.display.title") }}</p>
          <p class="setup-block-hint">
            {{ t("onboarding.setup.display.hint", { key: doubleTapKey }) }}
          </p>
          <div
            class="choice-row"
            role="listbox"
            :aria-label="t('onboarding.setup.display.title')"
          >
            <button
              v-for="opt in openMonitors"
              :key="opt.id"
              type="button"
              class="choice"
              role="option"
              :aria-selected="openMonitor === opt.id"
              :class="{ 'choice--active': openMonitor === opt.id }"
              @click="onOpenMonitor(opt.id)"
            >
              {{ opt.name }}
            </button>
          </div>
        </section>

        <p v-if="autostartError" class="setup-error">
          {{ t("onboarding.setup.autostart.error", { error: autostartError }) }}
        </p>

        <div class="setup-actions">
          <button type="button" class="setup-continue" :disabled="busy" @click="leaveMachinePage">
            {{ t("onboarding.setup.continue") }}
          </button>
        </div>
      </template>

      <template v-else-if="page === 'ai' && connectingTab">
        <div class="setup-connect-head">
          <button type="button" class="setup-back" @click="connecting = null">
            <span aria-hidden="true">‹</span> {{ t("onboarding.setup.ai.back") }}
          </button>
          <BrandMark
            :provider="credentialTypeForProvider(models, connectingTab.id) ?? connectingTab.id"
            :size="18"
          />
          <p class="setup-connect-title">{{ connectingTab.label }}</p>
        </div>
        <CredentialAccounts
          v-if="credentialTypeOf(connectingTab.id)"
          :key="credentialTypeOf(connectingTab.id)!.id"
          :type="credentialTypeOf(connectingTab.id)!"
          :credentials="credentials"
          @changed="onConnectionChanged"
        />
      </template>

      <template v-else-if="page === 'ai'">
        <p class="setup-title">{{ t("onboarding.setup.ai.title") }}</p>
        <p class="setup-lead">{{ t("onboarding.setup.ai.hint") }}</p>

        <p v-if="aiLoadError" class="setup-error">{{ t("onboarding.setup.ai.loadError") }}</p>
        <div v-else-if="aiLoaded" class="setup-providers">
          <button
            v-for="tab in AI_PROVIDER_TABS"
            :key="tab.id"
            type="button"
            class="setup-provider"
            @click="connecting = tab.id"
          >
            <BrandMark :provider="credentialTypeForProvider(models, tab.id) ?? tab.id" :size="18" />
            <span class="setup-provider-label">{{ tab.label }}</span>
            <span v-if="providerHasKey(models, tab.id)" class="setup-provider-status">
              {{ t("onboarding.setup.ai.connected") }}
            </span>
            <span class="setup-provider-chevron" aria-hidden="true">›</span>
          </button>
        </div>

        <div class="setup-actions">
          <button type="button" class="setup-continue" @click="leaveAiPage">
            {{ t("onboarding.setup.continue") }}
          </button>
        </div>
      </template>

      <template v-else>
        <section v-if="asksForDoubleTap" class="setup-gesture setup-gesture--first">
          <div class="setup-keys" aria-hidden="true">
            <kbd class="setup-keycap">{{ doubleTapKey }}</kbd>
            <kbd class="setup-keycap">{{ doubleTapKey }}</kbd>
          </div>
          <p class="setup-gesture-title">
            {{ t("onboarding.setup.gesture.title", { key: doubleTapKey }) }}
          </p>
          <p class="setup-gesture-body">{{ t("onboarding.setup.gesture.body") }}</p>
        </section>

        <section v-else class="setup-hint setup-gesture--first">
          <p class="setup-hint-title">{{ revealHint.title }}</p>
          <p class="setup-hint-body">
            <template v-for="(seg, i) in revealHint.segments" :key="i">
              <kbd v-if="seg.typed" class="setup-key">{{ seg.text }}</kbd>
              <template v-else>{{ seg.text }}</template>
            </template>
          </p>
        </section>

        <div class="setup-actions">
          <!-- Only the tour differs between the two; the answers on the earlier
               pages are already committed, and a connection saves itself. -->
          <button type="button" class="setup-skip" :disabled="busy" @click="onSkipTour">
            {{ t("onboarding.setup.skipTour") }}
          </button>
          <button
            type="button"
            class="setup-continue"
            :class="{ 'setup-continue--quiet': asksForDoubleTap }"
            :disabled="busy"
            @click="onContinue"
          >
            {{
              asksForDoubleTap ? t("onboarding.setup.orClick") : t("onboarding.setup.showMeAround")
            }}
          </button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.setup {
  position: fixed;
  inset: 0;
  z-index: 420;
  display: flex;
  align-items: center;
  justify-content: center;
  /* Same rule as the coach: the frame passes clicks through, the card does not. */
  pointer-events: none;
}

.setup-card {
  width: min(420px, calc(100vw - 48px));
  padding: 22px 24px;
  color: rgba(var(--fg-rgb), 0.92);
  /* Opaque: the card floats over whatever app is behind it, and text read
     through a busy terminal or page was hard to make out. */
  background: rgb(var(--surface-bg-rgb));
  border-radius: var(--surface-radius, 32px);
  corner-shape: var(--surface-corner-shape, round);
  box-shadow: var(--surface-box-shadow);
  backdrop-filter: var(--surface-backdrop-filter, blur(16px));
  pointer-events: auto;
}

.setup-head {
  display: flex;
  align-items: center;
  gap: 12px;
}

.setup-logo {
  flex: none;
  border-radius: 10px;
}

.setup-title {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
  line-height: 1.25;
}

.setup-lead {
  margin: 12px 0 0;
  font-size: 13px;
  line-height: 1.45;
  color: rgba(var(--fg-rgb), 0.7);
}

/* The card's centre of gravity: a panel, not a third setting. */
.setup-hint {
  margin-top: 18px;
  padding: 13px 15px;
  border-radius: 14px;
  background: rgba(var(--fg-rgb), 0.06);
  box-shadow: inset 0 0 0 1px rgba(var(--fg-rgb), 0.09);
}

/* The one gesture worth remembering, asked for rather than described. */
.setup-gesture {
  margin-top: 18px;
  padding: 20px 16px 18px;
  border-radius: 20px;
  corner-shape: var(--surface-corner-shape, round);
  background: rgba(var(--fg-rgb), 0.06);
  box-shadow: inset 0 0 0 1px rgba(var(--fg-rgb), 0.1);
  text-align: center;
}

.setup-keys {
  display: flex;
  justify-content: center;
  gap: 10px;
}

.setup-keycap {
  min-width: 64px;
  padding: 10px 14px 12px;
  font: inherit;
  font-size: 15px;
  font-weight: 700;
  color: rgb(var(--fg-rgb));
  background: rgba(var(--fg-rgb), 0.1);
  border: 1px solid rgba(var(--fg-rgb), 0.24);
  border-bottom-width: 3px;
  border-radius: 10px;
  animation: setup-tap 1.6s ease-in-out infinite;
}

/* Two taps in quick succession, then a rest: the rhythm of the gesture. */
.setup-keycap:nth-child(2) {
  animation-delay: 0.22s;
}

@keyframes setup-tap {
  0%,
  10%,
  100% {
    transform: none;
    border-bottom-width: 3px;
  }
  5% {
    transform: translateY(2px);
    border-bottom-width: 1px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .setup-keycap {
    animation: none;
  }
}

.setup-gesture-title {
  margin: 14px 0 0;
  font-size: 16px;
  font-weight: 700;
}

.setup-gesture-body {
  margin: 6px auto 0;
  max-width: 320px;
  font-size: 12.5px;
  line-height: 1.45;
  color: rgba(var(--fg-rgb), 0.6);
}

.setup-hint-title {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: rgba(var(--fg-rgb), 0.45);
}

.setup-hint-body {
  margin: 6px 0 0;
  font-size: 13px;
  line-height: 1.5;
  color: rgba(var(--fg-rgb), 0.92);
}

.setup-key {
  display: inline;
  padding: 1px 6px;
  font: inherit;
  font-weight: 700;
  font-family: ui-monospace, "Cascadia Code", "Segoe UI Mono", Consolas, monospace;
  color: rgba(var(--fg-rgb), 0.95);
  background: rgba(var(--fg-rgb), 0.12);
  border: 1px solid rgba(var(--fg-rgb), 0.22);
  border-radius: 5px;
}

.toggle {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-top: 18px;
  padding: 12px 14px;
  border-radius: 14px;
  background: rgba(var(--fg-rgb), 0.04);
  cursor: pointer;
}

.toggle:hover {
  background: rgba(var(--fg-rgb), 0.08);
}

.toggle-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
}

.toggle-title {
  font-size: 13px;
  font-weight: 500;
}

.toggle-hint {
  font-size: 12px;
  line-height: 1.4;
  color: rgba(var(--fg-rgb), 0.6);
}

.setup-block {
  margin-top: 18px;
}

.setup-block-title {
  margin: 0;
  font-size: 13px;
  font-weight: 500;
}

.setup-block-hint {
  margin: 4px 0 0;
  font-size: 12px;
  line-height: 1.4;
  color: rgba(var(--fg-rgb), 0.6);
}

.choice-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-top: 10px;
}

.choice {
  padding: 9px 8px;
  border: 1px solid transparent;
  border-radius: 12px;
  background: rgba(var(--fg-rgb), 0.04);
  color: rgba(var(--fg-rgb), 0.92);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
}

.choice:hover {
  background: rgba(var(--fg-rgb), 0.08);
}

.choice--active {
  background: var(--row-selected-sheen), var(--row-selected-bg);
  box-shadow: var(--row-selected-rim), var(--row-selected-shadow);
}

.setup-error {
  margin: 14px 0 0;
  font-size: 12px;
  line-height: 1.4;
  color: rgba(240, 170, 90, 0.95);
}

.setup-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 16px;
  margin-top: 20px;
}

/* Quiet on purpose: a real way out, not a competing offer. */
.setup-skip {
  padding: 0;
  border: 0;
  background: none;
  color: rgba(var(--fg-rgb), 0.65);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.setup-skip:hover,
.setup-skip:focus-visible {
  color: rgba(var(--fg-rgb), 0.9);
  outline: none;
}

.setup-skip:disabled {
  cursor: default;
  opacity: 0.6;
}

.setup-continue {
  padding: 9px 18px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: var(--row-selected-sheen), var(--row-selected-bg);
  box-shadow: var(--row-selected-rim), var(--row-selected-shadow);
  color: rgba(var(--fg-rgb), 0.95);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

/* The keyboard is the way forward; the button is there for whoever prefers a click. */
.setup-continue--quiet {
  background: rgba(var(--fg-rgb), 0.06);
  box-shadow: none;
  color: rgba(var(--fg-rgb), 0.75);
  font-weight: 500;
}

.setup-continue:disabled {
  cursor: default;
  opacity: 0.6;
}

/* The dots already sit above it; the block's own top margin would double the gap. */
.setup-gesture--first {
  margin-top: 0;
}

.setup-dots {
  display: flex;
  justify-content: center;
  gap: 6px;
  margin-bottom: 14px;
}

.setup-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: rgba(var(--fg-rgb), 0.2);
  transition: width 160ms ease;
}

.setup-dot--active {
  width: 18px;
  background: rgba(var(--fg-rgb), 0.7);
}

.setup-providers {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 14px;
}

.setup-provider {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 0;
  border-radius: 12px;
  background: rgba(var(--fg-rgb), 0.04);
  color: rgba(var(--fg-rgb), 0.92);
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.setup-provider:hover,
.setup-provider:focus-visible {
  background: rgba(var(--fg-rgb), 0.08);
  outline: none;
}

.setup-provider-label {
  flex: 1;
  font-weight: 500;
}

.setup-provider-status {
  font-size: 12px;
  color: rgba(120, 200, 140, 0.95);
}

.setup-provider-chevron {
  color: rgba(var(--fg-rgb), 0.4);
}

.setup-connect-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}

.setup-connect-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

.setup-back {
  padding: 0;
  margin-right: 4px;
  border: 0;
  background: none;
  color: rgba(var(--fg-rgb), 0.65);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.setup-back:hover,
.setup-back:focus-visible {
  color: rgba(var(--fg-rgb), 0.9);
  outline: none;
}

@media (max-width: 560px) {
  .choice-row {
    grid-template-columns: 1fr;
  }
}
</style>
