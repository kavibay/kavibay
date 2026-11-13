<script setup lang="ts">
/**
 * The first thing anybody ever sees: three pages of one card, always the same
 * size so nothing jumps while somebody reads it.
 *
 * Page 1 says what Kavibay is, in four lines, and asks nothing. The two
 * machine settings it used to ask about keep their defaults — start at login
 * (a launcher that is gone after the first reboot is a launcher the user has
 * lost) and open on the screen with the mouse — and both live in Settings. The
 * login entry is written when page 1 is left, and the page says so in one line.
 *
 * Page 2 asks which AI to use. OpenAI leads and starts expanded, because
 * "Sign in with ChatGPT" is the one way in that needs no key. Every row opens
 * in place to the connection form Settings → AI shows (`ProviderConnections`);
 * once a provider is connected the row shows which model Kavibay will answer
 * with, preselected to the catalog's recommendation. Not connecting anything is
 * an answer: the page can be skipped.
 *
 * The card can be dragged by any part that is not a control: the browser
 * sign-in for an AI provider opens behind Kavibay's always-on-top window,
 * exactly where the card sits, and a card that cannot move hides the page it
 * just sent the user to.
 *
 * Page 3 closes the setup: what pages 1 and 2 set up (the login entry, the
 * model Kavibay answers with, or where to add one), then the double tap that
 * starts the tour, as the page's one big thing. Pressed earlier, the gesture only turns the page
 * (`nextSetupPage`), so nobody skips a page unseen.
 */
import { computed, onMounted, onScopeDispose, ref, watch } from "vue";
import { holdHostDismiss } from "@sdk";
import { BrandMark } from "@sdk/brand";
import logo from "../../../src-tauri/icons/icon.svg";
import { t, type SimpleMessageKey } from "../i18n/i18n";
import { setClickThroughPaused, syncInteractiveRegions } from "../system/clickThrough";
import {
  getQuickActionModel,
  listLlmCatalog,
  setQuickActionModel,
  type LlmModelOption,
} from "../settings/ai/aiApi";
import {
  AI_PROVIDER_TABS,
  connectedProvider,
  credentialTypeForProvider,
  preferredQuickModel,
  quickModelChoices,
  tabHasKey,
  type AiProviderTab,
} from "../settings/ai/aiPanelLogic";
import ProviderConnections from "../settings/ai/ProviderConnections.vue";
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
  clampCardOffset,
  isSetupVisible,
  nextSetupPage,
  previousSetupPage,
  SETUP_PAGES,
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

const { supported: autostartSupported, setEnabled } = useAutostart();
const { declineTour } = useOnboarding();

const visible = computed(() => isSetupVisible(setupState.value));

/** Session-only: a restart while the card is pending starts again on page 1. */
const page = ref<SetupPage>("machine");
/** The expanded provider row on page 2. OpenAI starts open (see the top). */
const openTab = ref<ProviderId | null>(AI_PROVIDER_TABS[0].id);

/** Page 1's four lines: what Kavibay does, with a line icon each. */
const FEATURES: readonly { icon: string; title: SimpleMessageKey; body: SimpleMessageKey }[] = [
  {
    icon: "M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM20 20l-4.6-4.6",
    title: "onboarding.setup.feature.launch.title",
    body: "onboarding.setup.feature.launch.body",
  },
  {
    icon: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
    title: "onboarding.setup.feature.widgets.title",
    body: "onboarding.setup.feature.widgets.body",
  },
  {
    icon: "M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z",
    title: "onboarding.setup.feature.ai.title",
    body: "onboarding.setup.feature.ai.body",
  },
  {
    icon: "M4 20L15 9M14 4v3M19 4l-2 2M20 10h-3M9 4l1 2",
    title: "onboarding.setup.feature.build.title",
    body: "onboarding.setup.feature.build.body",
  },
];

/**
 * How to reach Kavibay, in the words this machine can honour.
 *
 * The card states it rather than teaching it — the tour's second step does the
 * teaching — because this is the only screen everybody sees, including the
 * people who skip the tour.
 */
const platform = keyPlatform();
const doubleTapKey = doubleTapKeyLabel(platform);
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

const busy = ref(false);

/** 1-based position for the dots' label. */
const pageNumber = computed(() => SETUP_PAGES.indexOf(page.value) + 1);

// AI page data: loaded once the page is reached, reloaded after every change a
// connection form reports — the same lists Settings → AI reads.
const models = ref<LlmModelOption[]>([]);
const types = ref<CredentialTypeSchema[]>([]);
const credentials = ref<CredentialSummary[]>([]);
/** The stored quick-model pick ("" is automatic). */
const quickSelected = ref("");
const aiLoaded = ref(false);
const aiLoadError = ref(false);
/** A connected row showing its connection form again, to change or add one. */
const managing = ref<ProviderId | null>(null);

async function loadAi() {
  try {
    const [loadedModels, loadedTypes, loadedCredentials, quick] = await Promise.all([
      listLlmCatalog(),
      listCredentialTypes(),
      listCredentials(),
      getQuickActionModel(),
    ]);
    models.value = loadedModels;
    types.value = loadedTypes;
    credentials.value = loadedCredentials;
    quickSelected.value = quick.selected;
    aiLoadError.value = false;
  } catch {
    // Not a reason to hold anybody here: the tour runs without AI, and
    // Settings → AI is where a connection can be made later.
    aiLoadError.value = true;
  }
  aiLoaded.value = true;
}

const anyConnected = computed(() => AI_PROVIDER_TABS.some((tab) => tabHasKey(models.value, tab)));

/** The model a connected row answers with: the stored pick, or the recommended one. */
function pickFor(tab: AiProviderTab): string | null {
  const provider = connectedProvider(models.value, tab);
  return provider ? preferredQuickModel(models.value, provider, quickSelected.value) : null;
}

/** The usable models of the provider that connected a row, for its picker. */
function choicesFor(tab: AiProviderTab): LlmModelOption[] {
  const provider = connectedProvider(models.value, tab);
  return quickModelChoices(models.value).filter((model) => model.provider === provider);
}

/** "ChatGPT plan" for the sign-in, the row's own name for its API key. */
function connectedName(tab: AiProviderTab): string {
  const provider = connectedProvider(models.value, tab);
  return tab.signIn && provider !== tab.id ? t("ai.connect.chatgptName") : tab.label;
}

/**
 * Store the model the card says it will use. Written for real, so "Kavibay
 * answers with this model" is true the moment it is shown.
 */
async function useModel(modelId: string) {
  quickSelected.value = modelId;
  try {
    await setQuickActionModel(modelId);
  } catch {
    // The picker in Settings → AI shows the stored choice; nothing to undo here.
  }
}

/** The connection form reported a change: adopt the recommended model once connected. */
async function onConnectionChanged(tab: AiProviderTab) {
  await loadAi();
  const pick = pickFor(tab);
  if (pick && pick !== quickSelected.value) await useModel(pick);
  if (tabHasKey(models.value, tab)) managing.value = null;
}

function toggleTab(id: ProviderId) {
  openTab.value = openTab.value === id ? null : id;
  managing.value = null;
}

/** The model the summary on page 3 names: the first connected row's pick. */
const summaryModel = computed(() => {
  for (const tab of AI_PROVIDER_TABS) {
    const pick = pickFor(tab);
    if (pick) return models.value.find((model) => model.id === pick)?.label ?? null;
  }
  return null;
});

function noteOf(modelId: string | null): string {
  return models.value.find((model) => model.id === modelId)?.note ?? "";
}

onMounted(() => {
  // The card is click-through until the host is told which pixels are ours.
  void syncInteractiveRegions();
});

// Dragging the card out of the way (see the top of the file).
const cardEl = ref<HTMLElement | null>(null);
const offset = ref({ x: 0, y: 0 });
let drag: { pointerId: number; x: number; y: number; from: { x: number; y: number } } | null = null;
const dragging = ref(false);

/** A press on one of these does its own thing; anywhere else on the card drags it. */
const NOT_A_HANDLE = "button, input, select, textarea, a, label, kbd, [contenteditable]";

function onCardPointerDown(event: PointerEvent) {
  const target = event.target as Element | null;
  if (event.button !== 0 || !cardEl.value || target?.closest(NOT_A_HANDLE)) return;
  // A press on a scrollbar scrolls; it is the only part of a plain element
  // that sits outside its client width.
  if (target instanceof HTMLElement && event.offsetX > target.clientWidth) return;
  drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, from: offset.value };
  dragging.value = true;
  cardEl.value.setPointerCapture(event.pointerId);
  // The cursor leaves the reported card rect while it moves; without the pause
  // the window turns click-through under it and the drag stops dead.
  setClickThroughPaused(true);
  event.preventDefault();
}

function onCardPointerMove(event: PointerEvent) {
  if (!drag || event.pointerId !== drag.pointerId || !cardEl.value) return;
  const rect = cardEl.value.getBoundingClientRect();
  const unshifted = {
    left: rect.left - offset.value.x,
    top: rect.top - offset.value.y,
    width: rect.width,
    height: rect.height,
  };
  offset.value = clampCardOffset(
    { x: drag.from.x + event.clientX - drag.x, y: drag.from.y + event.clientY - drag.y },
    unshifted,
    { width: window.innerWidth, height: window.innerHeight },
  );
}

function endDrag(event?: PointerEvent) {
  if (!drag || (event && event.pointerId !== drag.pointerId)) return;
  drag = null;
  dragging.value = false;
  setClickThroughPaused(false);
  void syncInteractiveRegions();
}
onScopeDispose(() => endDrag());

// Fixed size, so only a page switch can move what the host must keep clickable.
watch(page, () => void syncInteractiveRegions(), { flush: "post" });

/**
 * Write the login entry and turn to the AI page.
 *
 * Pre-decided rather than asked: page 1 states it, and Settings is where it is
 * switched off. A refused write is not a reason to keep the user here:
 * `useAutostart` puts the reason next to the switch in Settings.
 */
async function leaveMachinePage() {
  if (busy.value || page.value !== "machine") return;
  busy.value = true;
  if (autostartSupported.value) {
    await setEnabled(true);
  }
  busy.value = false;
  page.value = "ai";
  void loadAi();
}

/** On to the last page; a half-filled connection form is left behind unsaved. */
function leaveAiPage() {
  managing.value = null;
  const next = nextSetupPage(page.value);
  if (next !== "finish") page.value = next;
}

function goBack() {
  const previous = previousSetupPage(page.value);
  if (previous) page.value = previous;
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
      ref="cardEl"
      class="setup-card"
      :class="{ 'setup-card--dragging': dragging }"
      :style="{ transform: `translate(${offset.x}px, ${offset.y}px)` }"
      data-interactive
      role="dialog"
      :aria-label="t('onboarding.setup.ariaLabel')"
      @pointerdown="onCardPointerDown"
      @pointermove="onCardPointerMove"
      @pointerup="endDrag"
      @pointercancel="endDrag"
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
        <div class="setup-body">
          <div class="setup-brand">
            <img class="setup-logo" :src="logo" alt="" width="36" height="36" />
            <p class="setup-brand-name">Kavibay</p>
          </div>
          <p class="setup-headline">{{ t("onboarding.setup.welcome.headline") }}</p>
          <ul class="setup-features">
            <li v-for="feature in FEATURES" :key="feature.title" class="setup-feature">
              <svg class="setup-feature-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path :d="feature.icon" />
              </svg>
              <span class="setup-feature-copy">
                <span class="setup-feature-title">{{ t(feature.title) }}</span>
                <span class="setup-feature-body">{{ t(feature.body) }}</span>
              </span>
            </li>
          </ul>
        </div>
        <p v-if="autostartSupported" class="setup-footnote">
          {{ t("onboarding.setup.welcome.autostart", { place: waitingPlace(platform) }) }}
        </p>
        <div class="setup-actions">
          <button type="button" class="setup-continue" :disabled="busy" @click="leaveMachinePage">
            {{ t("onboarding.setup.welcome.continue") }}
          </button>
        </div>
      </template>

      <template v-else-if="page === 'ai'">
        <div class="setup-body">
          <p class="setup-title">{{ t("onboarding.setup.ai.title") }}</p>
          <p class="setup-lead">{{ t("onboarding.setup.ai.hint") }}</p>

          <p v-if="aiLoadError" class="setup-error">{{ t("onboarding.setup.ai.loadError") }}</p>
          <div v-else-if="aiLoaded" class="setup-providers">
            <div
              v-for="tab in AI_PROVIDER_TABS"
              :key="tab.id"
              class="setup-provider-item"
              :class="{ 'setup-provider-item--open': openTab === tab.id }"
            >
              <button
                type="button"
                class="setup-provider"
                :aria-expanded="openTab === tab.id"
                @click="toggleTab(tab.id)"
              >
                <BrandMark :provider="credentialTypeForProvider(models, tab.id) ?? tab.id" :size="18" />
                <span class="setup-provider-label">{{ tab.label }}</span>
                <span v-if="tabHasKey(models, tab)" class="setup-provider-status">
                  {{ t("onboarding.setup.ai.connected") }}
                </span>
                <svg class="setup-provider-chevron" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>

              <div v-if="openTab === tab.id" class="setup-provider-panel">
                <div v-if="pickFor(tab) && managing !== tab.id" class="setup-connected">
                  <p class="setup-connected-title">
                    <svg class="setup-connected-tick" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="m5 12.5 4.5 4.5L19 7.5" />
                    </svg>
                    {{ t("onboarding.setup.ai.connectedTo", { name: connectedName(tab) }) }}
                  </p>
                  <label class="setup-model">
                    <span class="setup-model-label">{{ t("onboarding.setup.ai.using") }}</span>
                    <select
                      class="setup-model-select"
                      :value="pickFor(tab)"
                      @change="useModel(($event.target as HTMLSelectElement).value)"
                    >
                      <option v-for="model in choicesFor(tab)" :key="model.id" :value="model.id">
                        {{ model.label }}
                      </option>
                    </select>
                  </label>
                  <p class="setup-model-note">{{ noteOf(pickFor(tab)) }}</p>
                  <p class="setup-model-hint">{{ t("onboarding.setup.ai.usingHint") }}</p>
                  <button type="button" class="setup-link" @click="managing = tab.id">
                    {{ t("onboarding.setup.ai.manage") }}
                  </button>
                </div>
                <ProviderConnections
                  v-else
                  :tab="tab"
                  :models="models"
                  :types="types"
                  :credentials="credentials"
                  @changed="onConnectionChanged(tab)"
                />
              </div>
            </div>
          </div>
        </div>

        <div class="setup-actions setup-actions--split">
          <button type="button" class="setup-skip" @click="goBack">
            {{ t("onboarding.setup.back") }}
          </button>
          <button type="button" class="setup-continue" @click="leaveAiPage">
            {{ anyConnected ? t("onboarding.setup.continue") : t("onboarding.setup.ai.skip") }}
          </button>
        </div>
      </template>

      <template v-else>
        <div class="setup-body setup-body--center">
          <p class="setup-title setup-title--center">{{ t("onboarding.setup.done.title") }}</p>
          <ul class="setup-summary">
            <li v-if="autostartSupported" class="setup-summary-row">
              <svg class="setup-summary-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="m5 12.5 4.5 4.5L19 7.5" />
              </svg>
              {{ t("onboarding.setup.done.autostart") }}
            </li>
            <li v-if="summaryModel" class="setup-summary-row">
              <svg class="setup-summary-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="m5 12.5 4.5 4.5L19 7.5" />
              </svg>
              {{ t("onboarding.setup.done.ai", { model: summaryModel }) }}
            </li>
            <li v-else class="setup-summary-row setup-summary-row--open">
              <svg class="setup-summary-icon" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="3" />
              </svg>
              {{ t("onboarding.setup.done.noAi") }}
            </li>
          </ul>

          <section v-if="asksForDoubleTap" class="setup-gesture">
            <div class="setup-keys" aria-hidden="true">
              <kbd class="setup-keycap">{{ doubleTapKey }}</kbd>
              <kbd class="setup-keycap">{{ doubleTapKey }}</kbd>
            </div>
            <p class="setup-gesture-title">
              {{ t("onboarding.setup.gesture.title", { key: doubleTapKey }) }}
            </p>
            <p class="setup-gesture-body">{{ t("onboarding.setup.gesture.body") }}</p>
          </section>

          <section v-else class="setup-hint">
            <p class="setup-hint-title">{{ revealHint.title }}</p>
            <p class="setup-hint-body">
              <template v-for="(seg, i) in revealHint.segments" :key="i">
                <kbd v-if="seg.typed" class="setup-key">{{ seg.text }}</kbd>
                <template v-else>{{ seg.text }}</template>
              </template>
            </p>
          </section>
        </div>

        <div class="setup-actions setup-actions--split">
          <button type="button" class="setup-skip" :disabled="busy" @click="goBack">
            {{ t("onboarding.setup.back") }}
          </button>
          <span class="setup-actions-end">
            <!-- Only the tour differs between the two; the earlier pages'
                 answers are already committed, and a connection saves itself. -->
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
          </span>
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

/*
 * One size for every page and every open row: a card that grows when a row
 * opens moves the button the user was about to press. What does not fit
 * scrolls inside `.setup-body`; the dots and the buttons stay put.
 */
.setup-card {
  display: flex;
  flex-direction: column;
  width: min(440px, calc(100vw - 48px));
  height: min(560px, calc(100vh - 48px));
  padding: 20px 24px 22px;
  color: rgba(var(--fg-rgb), 0.92);
  /* Opaque: the card floats over whatever app is behind it, and text read
     through a busy terminal or page was hard to make out. */
  background: rgb(var(--surface-bg-rgb));
  border-radius: var(--surface-radius, 32px);
  corner-shape: var(--surface-corner-shape, round);
  box-shadow: var(--surface-box-shadow);
  backdrop-filter: var(--surface-backdrop-filter, blur(16px));
  pointer-events: auto;
  cursor: grab;
}

.setup-card--dragging {
  cursor: grabbing;
  user-select: none;
}

.setup-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  /* Room for focus rings and the scrollbar without clipping row edges. */
  margin: 0 -8px;
  padding: 2px 8px;
}

.setup-body--center {
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.setup-dots {
  display: flex;
  flex: none;
  justify-content: center;
  gap: 6px;
  margin-bottom: 16px;
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

/* Page 1 */

.setup-brand {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
}

.setup-logo {
  flex: none;
  border-radius: 9px;
}

.setup-brand-name {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.01em;
}

.setup-headline {
  margin: 16px 0 0;
  font-size: 17px;
  font-weight: 600;
  line-height: 1.3;
  text-align: center;
}

.setup-features {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin: 22px 0 0;
  padding: 0;
  list-style: none;
}

.setup-feature {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.setup-feature-icon {
  flex: none;
  width: 18px;
  height: 18px;
  margin-top: 1px;
  fill: none;
  stroke: rgba(var(--fg-rgb), 0.8);
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.setup-feature-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.setup-feature-title {
  font-size: 13.5px;
  font-weight: 600;
}

.setup-feature-body {
  font-size: 12.5px;
  line-height: 1.4;
  color: rgba(var(--fg-rgb), 0.62);
}

.setup-footnote {
  flex: none;
  margin: 14px 0 0;
  font-size: 11.5px;
  line-height: 1.4;
  text-align: center;
  color: rgba(var(--fg-rgb), 0.5);
}

/* Page 2 */

.setup-title {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
  line-height: 1.25;
}

.setup-lead {
  margin: 8px 0 0;
  font-size: 13px;
  line-height: 1.45;
  color: rgba(var(--fg-rgb), 0.7);
}

.setup-providers {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 14px;
}

.setup-provider-item {
  border-radius: 12px;
  background: rgba(var(--fg-rgb), 0.04);
}

.setup-provider-item--open {
  background: rgba(var(--fg-rgb), 0.06);
}

.setup-provider {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 0;
  border-radius: 12px;
  background: none;
  color: rgba(var(--fg-rgb), 0.92);
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.setup-provider:hover,
.setup-provider:focus-visible {
  background: rgba(var(--fg-rgb), 0.05);
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
  width: 16px;
  height: 16px;
  fill: none;
  stroke: rgba(var(--fg-rgb), 0.45);
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
  transition: transform 160ms ease;
}

.setup-provider-item--open .setup-provider-chevron {
  transform: rotate(180deg);
}

.setup-provider-panel {
  padding: 4px 12px 12px;
}

.setup-connected {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.setup-connected-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 13px;
  font-weight: 600;
}

.setup-connected-tick {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: rgba(120, 200, 140, 0.95);
  stroke-width: 2.2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.setup-model {
  display: flex;
  align-items: center;
  gap: 10px;
}

.setup-model-label {
  font-size: 12.5px;
  color: rgba(var(--fg-rgb), 0.65);
}

.setup-model-select {
  padding: 6px 10px;
  border: 1px solid rgba(var(--fg-rgb), 0.16);
  border-radius: 999px;
  background: rgba(var(--fg-rgb), 0.06);
  color: rgba(var(--fg-rgb), 0.92);
  font: inherit;
  font-size: 12.5px;
  cursor: pointer;
}

.setup-model-note {
  margin: 0;
  font-size: 12px;
  color: rgba(120, 200, 140, 0.9);
}

.setup-model-hint {
  margin: 0;
  font-size: 12px;
  line-height: 1.4;
  color: rgba(var(--fg-rgb), 0.55);
}

.setup-link {
  align-self: flex-start;
  padding: 0;
  border: 0;
  background: none;
  color: rgba(var(--fg-rgb), 0.7);
  font: inherit;
  font-size: 12px;
  text-decoration: underline;
  text-underline-offset: 3px;
  cursor: pointer;
}

.setup-link:hover,
.setup-link:focus-visible {
  color: rgba(var(--fg-rgb), 0.95);
  outline: none;
}

/* Page 3 */

/* Without a gesture to ask for, the way back in is a panel to read. */
.setup-hint {
  margin-top: 32px;
  padding: 13px 15px;
  border-radius: 14px;
  background: rgba(var(--fg-rgb), 0.06);
  box-shadow: inset 0 0 0 1px rgba(var(--fg-rgb), 0.09);
}

.setup-title--center {
  text-align: center;
}

/* What the earlier pages set up, read at a glance. */
.setup-summary {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  margin: 14px 0 0;
  padding: 0;
  list-style: none;
}

.setup-summary-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: rgba(var(--fg-rgb), 0.8);
}

.setup-summary-row--open {
  color: rgba(var(--fg-rgb), 0.55);
}

.setup-summary-icon {
  flex: none;
  width: 16px;
  height: 16px;
  fill: none;
  stroke: rgba(120, 200, 140, 0.95);
  stroke-width: 2.2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.setup-summary-row--open .setup-summary-icon {
  fill: rgba(var(--fg-rgb), 0.4);
  stroke: none;
}

/* The one gesture worth remembering, asked for rather than described: the
   page's centrepiece, so no panel around it. */
.setup-gesture {
  margin-top: 40px;
  text-align: center;
}

.setup-keys {
  display: flex;
  justify-content: center;
  gap: 14px;
}

.setup-keycap {
  min-width: 88px;
  padding: 16px 20px 18px;
  font: inherit;
  font-size: 20px;
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
  margin: 20px 0 0;
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

/* Shared */

.setup-error {
  margin: 14px 0 0;
  font-size: 12px;
  line-height: 1.4;
  color: rgba(240, 170, 90, 0.95);
}

.setup-actions {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: flex-end;
  gap: 16px;
  margin-top: 16px;
}

.setup-actions--split {
  justify-content: space-between;
}

.setup-actions-end {
  display: flex;
  align-items: center;
  gap: 16px;
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
</style>
