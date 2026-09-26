/**
 * Run: npx tsx core/app/onboarding/onboardingCopy.assert.ts
 *
 * The copy record is data, but the hotkey step is not: it picks between three
 * instructions based on what the host says the machine can deliver, and picking
 * wrong there is the one mistake in onboarding that can leave a user unable to
 * reach the app at all.
 */
import {
  onboardingCopyForStep,
  onboardingCoreDoneCopy,
  onboardingHotkeyCopy,
  onboardingHotkeyFallbackCopy,
  onboardingRevealHintCopy,
} from "./onboardingCopy";
import {
  ONBOARDING_CORE_DONE_STEP,
  ONBOARDING_DONE_STEP,
  ONBOARDING_HOTKEY_STEP,
  type OnboardingStep,
} from "./onboardingLogic";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

/** The rendered sentence, as the bubble concatenates it. */
function text(copy: { segments: { text: string }[] }): string {
  return copy.segments.map((s) => s.text).join("");
}

// Every step has copy, so a renumbering cannot leave a blank bubble.
for (let step = 1; step <= ONBOARDING_DONE_STEP; step += 1) {
  const copy = onboardingCopyForStep(step as OnboardingStep);
  assert(copy != null, `step ${step} has copy`);
  assert(copy.title.length > 0, `step ${step} has a title`);
  assert(text(copy).length > 0, `step ${step} has a body`);
}

// The hotkey step teaches whichever keystroke exists here — and only that one.
const doubleTap = onboardingHotkeyCopy("ctrlDoubleTap");
assert(text(doubleTap).includes("Ctrl"), "double-tap copy names Ctrl");
assert(!text(doubleTap).includes("Shift+Ctrl+Space"), "double-tap copy does not name the fallback");
assert(
  doubleTap.segments.some((s) => s.typed && s.text === "Ctrl"),
  "double-tap copy marks Ctrl as a key",
);

const elsewhere = onboardingHotkeyCopy("cursorHotkey");
assert(
  elsewhere.segments.some((s) => s.typed && s.text === "Shift+Ctrl+Space"),
  "fallback copy marks Shift+Ctrl+Space as a key",
);
assert(
  !text(elsewhere).includes("twice"),
  "fallback copy does not teach a double tap that does not exist here",
);

// No keystroke at all: the card must not ask for one, and must name the tray.
const none = onboardingHotkeyCopy(null);
assert(text(none).toLowerCase().includes("tray"), "no-gesture copy names the tray");
assert(
  !none.segments.some((s) => s.typed),
  "no-gesture copy asks the user to press nothing",
);

// The step reached through onboardingCopyForStep must agree with the direct call.
assert(
  text(onboardingCopyForStep(ONBOARDING_HOTKEY_STEP, { revealGesture: "cursorHotkey" })) ===
    text(elsewhere),
  "copyForStep routes the hotkey step to the gesture copy",
);
// A missing gesture option must not silently become the double-tap lesson: absent
// means "host has not answered", and the tray is the only safe thing to say.
assert(
  text(onboardingCopyForStep(ONBOARDING_HOTKEY_STEP)) === text(none),
  "copyForStep with no gesture falls back to the tray copy",
);

// The give-up copy explains the right cause for each platform, and always ends
// on routes that do not depend on the keystroke that just failed.
const failedDoubleTap = onboardingHotkeyFallbackCopy("ctrlDoubleTap");
assert(text(failedDoubleTap).includes("double tap"), "double-tap fallback blames the double tap");
const failedElsewhere = onboardingHotkeyFallbackCopy("cursorHotkey");
assert(
  text(failedElsewhere).includes("another program"),
  "accelerator fallback blames the program holding it",
);
for (const copy of [failedDoubleTap, failedElsewhere, onboardingHotkeyFallbackCopy(null)]) {
  assert(text(copy).toLowerCase().includes("tray"), "every fallback names the tray");
  assert(text(copy).includes("Ctrl+Space"), "every fallback names peek");
}

// The restore step names the widget the user just hid, when there is one.
const RESTORE_STEP = 11;
const restore = onboardingCopyForStep(RESTORE_STEP, { hiddenWidgetName: "  Clock  " });
assert(
  restore.segments.some((s) => s.typed && s.text === "Clock"),
  "restore copy names the hidden widget, trimmed",
);
assert(
  !onboardingCopyForStep(RESTORE_STEP, { hiddenWidgetName: "   " }).segments.some((s) => s.typed),
  "a blank widget name falls back to the generic hint",
);

// The core card is an ending that offers more, so it has to read as both.
const coreDone = onboardingCopyForStep(ONBOARDING_CORE_DONE_STEP);
assert(
  text(coreDone) === text(onboardingCoreDoneCopy()),
  "copyForStep routes the core card to its own copy",
);
assert(
  !text(coreDone).toLowerCase().includes("skip"),
  "the core card does not offer to skip something already finished",
);
assert(
  text(coreDone).toLowerCase().includes("or take"),
  "the core card offers the rest rather than continuing into it",
);

// The welcome card's hint is the only mention of the gesture that everybody
// sees — the tour's lesson is behind a button somebody may never press. It has
// to name the same key the lesson would, or the card teaches a key this machine
// cannot deliver.
for (const gesture of ["ctrlDoubleTap", "cursorHotkey", null] as const) {
  const hint = onboardingRevealHintCopy(gesture);
  const lesson = onboardingHotkeyCopy(gesture);
  assert(hint.title.length > 0, `hint has a title (${gesture})`);
  assert(text(hint).length > 0, `hint has a body (${gesture})`);
  const hintKeys = hint.segments.filter((s) => s.typed).map((s) => s.text);
  const lessonKeys = lesson.segments.filter((s) => s.typed).map((s) => s.text);
  assert(
    JSON.stringify([...new Set(hintKeys)]) === JSON.stringify([...new Set(lessonKeys)]),
    `hint and lesson name the same keys (${gesture})`,
  );
}
assert(
  text(onboardingRevealHintCopy(null)).toLowerCase().includes("tray"),
  "with no keystroke the hint names the tray",
);
// A statement, not an instruction: performing the gesture on the card would
// hide it before the autostart answer is committed.
assert(
  !text(onboardingRevealHintCopy("ctrlDoubleTap")).includes("this card"),
  "the hint does not ask the user to make the card disappear",
);

console.log("onboardingCopy.assert.ts: ok");
