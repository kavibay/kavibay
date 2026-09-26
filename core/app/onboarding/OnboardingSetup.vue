<script setup lang="ts">
/**
 * The first thing anybody ever sees: the greeting and the two setup questions,
 * on one card.
 *
 * They were two screens — a welcome bubble, then a form — which is one click
 * and one full redraw to say a thing that fits in a paragraph. Worse, the
 * welcome arrived over an open search field and a desk of cards, so the moment
 * meant to introduce the app was also its busiest. Now nothing else is on
 * screen until this is answered: no palette, no widgets, no coach.
 *
 * Two decisions, both about the machine rather than about Kavibay, and both
 * with a sensible default — so the card is readable in a few seconds and
 * answered by one button. Everything else a user might want to configure is in
 * Settings, where they will look for it anyway; see `setupLogic.ts` for why
 * this is a form and not a tour step.
 *
 * The two answers commit differently, on purpose. The display choice is an
 * ordinary preference and is written the moment it is clicked, exactly as the
 * same control does in Settings. Autostart writes *outside* the app — a
 * registry entry, a file in the user's config directory — so it is presented
 * pre-selected and written on Continue: the user sees what will happen before
 * anything happens, and closing the card without pressing it leaves the machine
 * untouched.
 */
import { computed, onMounted, ref } from "vue";
import { availableMonitors } from "@tauri-apps/api/window";
import { syncInteractiveRegions } from "../system/clickThrough";
import { openMonitorOptions, type OpenMonitor } from "../settings/appearanceLogic";
import { useAppearance } from "../settings/useAppearance";
import { revealGesture } from "../host/revealGesture";
import { doubleTapKeyLabel, keyPlatform } from "../host/shortcutHints";
import { onboardingRevealHintCopy, waitingPlace } from "./onboardingCopy";
import { isSetupVisible, shouldOfferDisplayChoice } from "./setupLogic";
import { finishSetup, setupState } from "./setupSession";
import { useAutostart } from "./useAutostart";
import { useOnboarding } from "./useOnboarding";

const { openMonitor, setOpenMonitor } = useAppearance();
const { supported: autostartSupported, error: autostartError, setEnabled } = useAutostart();
const { declineTour } = useOnboarding();

const visible = computed(() => isSetupVisible(setupState.value));

/**
 * What Continue will write. Starts on because a launcher the user has to
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

const busy = ref(false);

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

/** Pick which display the double tap covers. Persists immediately. */
function onOpenMonitor(target: OpenMonitor) {
  setOpenMonitor(target);
}

/**
 * Commit the autostart choice and close the card.
 *
 * What happens next — the desk, the palette, the tour — is the host's to
 * sequence: it watches `setupState` and reveals them in one place. This card is
 * a form and stops at being one.
 *
 * A refused write is not a reason to keep the user here: `useAutostart` puts
 * the reason next to the switch in Settings, and the entry is not something the
 * rest of onboarding depends on.
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
  if (autostartSupported.value) {
    await setEnabled(wantsAutostart.value);
  }
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
    <div class="setup-card" data-interactive role="dialog" aria-label="Set up Kavibay">
      <p class="setup-title">Hey — welcome to Kavibay</p>
      <p class="setup-lead">
        Your desk, your launcher, your little superpowers. Two quick things and
        then a short tour — about a minute, and you’ll feel at home.
      </p>

      <section class="setup-hint">
        <p class="setup-hint-title">{{ revealHint.title }}</p>
        <p class="setup-hint-body">
          <template v-for="(seg, i) in revealHint.segments" :key="i">
            <kbd v-if="seg.typed" class="setup-key">{{ seg.text }}</kbd>
            <template v-else>{{ seg.text }}</template>
          </template>
        </p>
      </section>

      <label v-if="autostartSupported" class="toggle">
        <span class="toggle-copy">
          <span class="toggle-title">Start Kavibay when I log in</span>
          <span class="toggle-hint">Waits in {{ waitingPlace(platform) }}, out of the way.</span>
        </span>
        <span class="switch">
          <input type="checkbox" v-model="wantsAutostart" />
          <span class="switch-ui" />
        </span>
      </label>

      <section v-if="offerDisplayChoice" class="setup-block">
        <p class="setup-block-title">Open on</p>
        <p class="setup-block-hint">
          You have more than one screen. Which one should a double tap on
          {{ doubleTapKey }} cover?
        </p>
        <div class="choice-row" role="listbox" aria-label="Open on">
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
        Could not change the startup entry: {{ autostartError }}
      </p>

      <div class="setup-actions">
        <!-- Both buttons commit the autostart choice; only the tour differs.
             Somebody who does not want to be shown around still answered the
             question, and their answer has to stick. -->
        <button type="button" class="setup-skip" :disabled="busy" @click="onSkipTour">
          Skip the tour
        </button>
        <button type="button" class="setup-continue" :disabled="busy" @click="onContinue">
          Show me around
        </button>
      </div>
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
  padding: 20px 22px;
  color: rgba(var(--fg-rgb), 0.92);
  background: rgba(var(--surface-bg-rgb), 0.92);
  border-radius: var(--surface-radius, 16px);
  box-shadow: var(--surface-box-shadow);
  backdrop-filter: var(--surface-backdrop-filter, blur(16px));
  pointer-events: auto;
}

.setup-title {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
  line-height: 1.25;
}

.setup-lead {
  margin: 6px 0 0;
  font-size: 13px;
  line-height: 1.45;
  color: rgba(var(--fg-rgb), 0.55);
}

/* The card's centre of gravity: a panel, not a third setting. */
.setup-hint {
  margin-top: 18px;
  padding: 13px 15px;
  border-radius: 14px;
  background: rgba(var(--fg-rgb), 0.06);
  box-shadow: inset 0 0 0 1px rgba(var(--fg-rgb), 0.09);
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
  color: rgba(var(--fg-rgb), 0.45);
}

.switch {
  position: relative;
  display: inline-flex;
  flex: none;
  margin-top: 1px;
}

.switch input {
  position: absolute;
  width: 0;
  height: 0;
  opacity: 0;
}

.switch-ui {
  position: relative;
  width: 36px;
  height: 20px;
  border-radius: 999px;
  background: rgba(var(--fg-rgb), 0.15);
}

.switch-ui::after {
  content: "";
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: rgba(var(--fg-rgb), 0.85);
}

.switch input:checked + .switch-ui {
  background: rgba(var(--fg-rgb), 0.82);
}

.switch input:checked + .switch-ui::after {
  background: rgb(var(--surface-bg-rgb));
  transform: translateX(16px);
}

.switch input:focus-visible + .switch-ui {
  outline: 2px solid rgba(var(--fg-rgb), 0.55);
  outline-offset: 2px;
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
  color: rgba(var(--fg-rgb), 0.45);
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
  color: rgba(var(--fg-rgb), 0.5);
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

.setup-continue:disabled {
  cursor: default;
  opacity: 0.6;
}

@media (max-width: 560px) {
  .choice-row {
    grid-template-columns: 1fr;
  }
}
</style>
