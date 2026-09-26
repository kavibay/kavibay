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
  waitingPlace,
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
  const copy = onboardingCopyForStep(step as OnboardingStep, "pc");
  assert(copy != null, `step ${step} has copy`);
  assert(copy.title.length > 0, `step ${step} has a title`);
  assert(text(copy).length > 0, `step ${step} has a body`);
}

// The hotkey step teaches whichever keystroke exists here — and only that one.
const doubleTap = onboardingHotkeyCopy("ctrlDoubleTap", "pc");
assert(text(doubleTap).includes("Ctrl"), "double-tap copy names Ctrl");
assert(!text(doubleTap).includes("Shift+Ctrl+Space"), "double-tap copy does not name the fallback");
assert(
  doubleTap.segments.some((s) => s.typed && s.text === "Ctrl"),
  "double-tap copy marks Ctrl as a key",
);

const elsewhere = onboardingHotkeyCopy("cursorHotkey", "pc");
assert(
  elsewhere.segments.some((s) => s.typed && s.text === "Shift+Ctrl+Space"),
  "fallback copy marks Shift+Ctrl+Space as a key",
);
assert(
  !text(elsewhere).includes("twice"),
  "fallback copy does not teach a double tap that does not exist here",
);

// No keystroke at all: the card must not ask for one, and must name the tray.
const none = onboardingHotkeyCopy(null, "pc");
assert(text(none).toLowerCase().includes("tray"), "no-gesture copy names the tray");
assert(
  !none.segments.some((s) => s.typed),
  "no-gesture copy asks the user to press nothing",
);

// The step reached through onboardingCopyForStep must agree with the direct call.
assert(
  text(onboardingCopyForStep(ONBOARDING_HOTKEY_STEP, "pc", { revealGesture: "cursorHotkey" })) ===
    text(elsewhere),
  "copyForStep routes the hotkey step to the gesture copy",
);
// A missing gesture option must not silently become the double-tap lesson: absent
// means "host has not answered", and the tray is the only safe thing to say.
assert(
  text(onboardingCopyForStep(ONBOARDING_HOTKEY_STEP, "pc")) === text(none),
  "copyForStep with no gesture falls back to the tray copy",
);

// The give-up copy explains the right cause for each platform, and always ends
// on routes that do not depend on the keystroke that just failed.
const failedDoubleTap = onboardingHotkeyFallbackCopy("ctrlDoubleTap", "pc");
assert(text(failedDoubleTap).includes("double tap"), "double-tap fallback blames the double tap");
const failedElsewhere = onboardingHotkeyFallbackCopy("cursorHotkey", "pc");
assert(
  text(failedElsewhere).includes("another program"),
  "accelerator fallback blames the program holding it",
);
for (const copy of [failedDoubleTap, failedElsewhere, onboardingHotkeyFallbackCopy(null, "pc")]) {
  assert(text(copy).toLowerCase().includes("tray"), "every fallback names the tray");
  assert(text(copy).includes("Ctrl+Space"), "every fallback names peek");
}

// The restore step names the widget the user just hid, when there is one.
const RESTORE_STEP = 11;
const restore = onboardingCopyForStep(RESTORE_STEP, "pc", { hiddenWidgetName: "  Clock  " });
assert(
  restore.segments.some((s) => s.typed && s.text === "Clock"),
  "restore copy names the hidden widget, trimmed",
);
assert(
  !onboardingCopyForStep(RESTORE_STEP, "pc", { hiddenWidgetName: "   " }).segments.some((s) => s.typed),
  "a blank widget name falls back to the generic hint",
);

// The core card is an ending that offers more, so it has to read as both.
const coreDone = onboardingCopyForStep(ONBOARDING_CORE_DONE_STEP, "pc");
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
for (const platform of ["pc", "mac"] as const) {
  for (const gesture of ["ctrlDoubleTap", "cursorHotkey", null] as const) {
    const hint = onboardingRevealHintCopy(gesture, platform);
    const lesson = onboardingHotkeyCopy(gesture, platform);
    assert(hint.title.length > 0, `hint has a title (${gesture}, ${platform})`);
    assert(text(hint).length > 0, `hint has a body (${gesture}, ${platform})`);
    const hintKeys = hint.segments.filter((s) => s.typed).map((s) => s.text);
    const lessonKeys = lesson.segments.filter((s) => s.typed).map((s) => s.text);
    assert(
      JSON.stringify([...new Set(hintKeys)]) === JSON.stringify([...new Set(lessonKeys)]),
      `hint and lesson name the same keys (${gesture}, ${platform})`,
    );
  }
}
assert(
  text(onboardingRevealHintCopy(null, "pc")).toLowerCase().includes("tray"),
  "with no keystroke the hint names the tray",
);
// A statement, not an instruction: performing the gesture on the card would
// hide it before the autostart answer is committed.
assert(
  !text(onboardingRevealHintCopy("ctrlDoubleTap", "pc")).includes("this card"),
  "the hint does not ask the user to make the card disappear",
);

// On a Mac the double tap is on Control (⌃), and a Mac user told "Ctrl" reaches
// for ⌘ first. Every place the tour names that key says so; a PC keeps "Ctrl".
assert(
  text(onboardingHotkeyCopy("ctrlDoubleTap", "mac")) ===
    "Tap ⌃ Control twice — everything disappears, this card included. Tap ⌃ Control twice again and it is all back. That is how you reach Kavibay from anywhere.",
  "the Mac lesson names ⌃ Control",
);
assert(
  onboardingHotkeyCopy("ctrlDoubleTap", "mac").segments.some(
    (s) => s.typed && s.text === "⌃ Control",
  ),
  "the Mac lesson marks ⌃ Control as a key",
);
assert(
  text(onboardingHotkeyCopy("ctrlDoubleTap", "pc")) ===
    "Tap Ctrl twice — everything disappears, this card included. Tap Ctrl twice again and it is all back. That is how you reach Kavibay from anywhere.",
  "the PC lesson is unchanged",
);
assert(
  text(onboardingRevealHintCopy("ctrlDoubleTap", "mac")) ===
    "Tap ⌃ Control twice, any time, in any app — that brings Kavibay up. Tap it twice again and everything is out of the way.",
  "the Mac hint names ⌃ Control",
);
assert(
  text(onboardingRevealHintCopy("ctrlDoubleTap", "pc")) ===
    "Tap Ctrl twice, any time, in any app — that brings Kavibay up. Tap it twice again and everything is out of the way.",
  "the PC hint is unchanged",
);
const PIN_STEP = 9;
assert(
  text(onboardingCopyForStep(PIN_STEP, "mac")).includes("with a double tap on ⌃ Control"),
  "the Mac pin lesson names ⌃ Control",
);
assert(
  text(onboardingCopyForStep(PIN_STEP, "pc")).includes("with a double tap on Ctrl"),
  "the PC pin lesson names Ctrl",
);

// With no keystroke at all, the Mac copy points at the menu bar icon, which
// opens its menu on one click; the PC copy keeps the tray double click.
assert(
  text(onboardingHotkeyCopy(null, "mac")) ===
    "No keyboard shortcut is free on this machine, so the menu bar is your way in: click the Kavibay icon up there and choose Open, and the desk comes back. Worth knowing before anything else.",
  "the Mac no-gesture lesson names the menu bar and Open",
);
assert(
  text(onboardingHotkeyCopy(null, "pc")) ===
    "No keyboard shortcut is free on this machine, so the tray is your way in: double-click the Kavibay icon down by the clock and the desk comes back. Worth knowing before anything else.",
  "the PC no-gesture lesson is unchanged",
);
assert(
  text(onboardingRevealHintCopy(null, "mac")) ===
    "No keyboard shortcut was free on this machine, so the menu bar is your way in: click the Kavibay icon up there and choose Open, and the desk comes back.",
  "the Mac no-gesture hint names the menu bar and Open",
);

// The Mac give-up copy names no cause: Secure Event Input was measured and does
// not block the monitor, and the Windows causes do not exist there.
const macFailedDoubleTap = text(onboardingHotkeyFallbackCopy("ctrlDoubleTap", "mac"));
assert(
  macFailedDoubleTap ===
    "The double tap on ⌃ Control never made it through to me. Two ways in that always work: click the Kavibay icon in the menu bar and choose Open, or hold Ctrl+Space for a peek at your widgets.",
  "the Mac double-tap fallback says the tap did not arrive and names the menu bar",
);
assert(!macFailedDoubleTap.includes("elevated"), "the Mac fallback names no elevated window");
assert(!macFailedDoubleTap.includes("remote session"), "the Mac fallback names no remote session");
assert(!macFailedDoubleTap.includes("double-click"), "the Mac fallback asks for no double click");
assert(
  text(failedDoubleTap) ===
    "The double tap needs to see your keyboard, and something on this machine is keeping it from me — an elevated window or a remote session will do that. Two ways in that always work: double-click the Kavibay icon in the tray, or hold Ctrl+Space for a peek at your widgets.",
  "the PC double-tap fallback is unchanged",
);
assert(
  text(onboardingHotkeyFallbackCopy("cursorHotkey", "mac")) ===
    "That shortcut did not reach me; another program is most likely holding it. Two ways in that always work: click the Kavibay icon in the menu bar and choose Open, or hold Ctrl+Space for a peek at your widgets.",
  "the Mac accelerator fallback names the menu bar",
);

assert(waitingPlace("mac") === "the menu bar", "a Mac keeps Kavibay in the menu bar");
assert(waitingPlace("pc") === "the tray", "Windows keeps it in the tray");

console.log("onboardingCopy.assert.ts: ok");
