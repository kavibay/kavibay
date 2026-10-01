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
  onboardingDoneCopy,
  onboardingHotkeyCopy,
  onboardingHotkeyFallbackCopy,
  onboardingRevealHintCopy,
  waitingPlace,
} from "./onboardingCopy";
import {
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
  text(failedElsewhere).toLowerCase().includes("another program"),
  "accelerator fallback blames the program holding it",
);
for (const copy of [failedDoubleTap, failedElsewhere, onboardingHotkeyFallbackCopy(null, "pc")]) {
  assert(text(copy).toLowerCase().includes("tray"), "every fallback names the tray");
  assert(text(copy).includes("Ctrl+Space"), "every fallback names peek");
}

// Answering the setup card with the double tap already taught the gesture, so
// the lesson picks up with the round trip instead of asking for it again.
const roundTrip = onboardingHotkeyCopy("ctrlDoubleTap", "pc", true);
assert(roundTrip.title !== doubleTap.title, "after the setup gesture the lesson reads as a follow-up");
assert(text(roundTrip).includes("again"), "the follow-up still promises it all comes back");
assert(
  text(onboardingCopyForStep(ONBOARDING_HOTKEY_STEP, "pc", {
    revealGesture: "ctrlDoubleTap",
    afterSetupGesture: true,
  })) === text(roundTrip),
  "copyForStep routes the setup gesture to the follow-up",
);

// The ending card is an ending: nothing to skip, and it says where the tour lives.
const done = onboardingCopyForStep(ONBOARDING_DONE_STEP, "pc");
assert(text(done) === text(onboardingDoneCopy()), "copyForStep routes the ending to its own copy");
assert(!text(done).toLowerCase().includes("skip"), "the ending does not offer to skip");
assert(
  done.segments.some((s) => s.typed && s.text === "Replay Tour"),
  "the ending names the command that brings the tour back",
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
// A statement, not an instruction: the setup card shows this where the double
// tap does not exist, so there is nothing for the card to make disappear.
assert(
  !text(onboardingRevealHintCopy("ctrlDoubleTap", "pc")).includes("this card"),
  "the hint does not ask the user to make the card disappear",
);

// On a Mac the double tap is on Control (⌃), and a Mac user told "Ctrl" reaches
// for ⌘ first. Every place the tour names that key says so; a PC keeps "Ctrl".
assert(
  text(onboardingHotkeyCopy("ctrlDoubleTap", "mac")) ===
    "Tap ⌃ Control twice and everything disappears, this card included. Tap ⌃ Control twice again and it's all back. That's how you reach Kavibay from any app.",
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
    "Tap Ctrl twice and everything disappears, this card included. Tap Ctrl twice again and it's all back. That's how you reach Kavibay from any app.",
  "the PC lesson names Ctrl",
);
assert(
  text(onboardingRevealHintCopy("ctrlDoubleTap", "mac")) ===
    "Tap ⌃ Control twice in any app to bring Kavibay up. Tap it twice again to put everything away.",
  "the Mac hint names ⌃ Control",
);
assert(
  text(onboardingRevealHintCopy("ctrlDoubleTap", "pc")) ===
    "Tap Ctrl twice in any app to bring Kavibay up. Tap it twice again to put everything away.",
  "the PC hint names Ctrl",
);

// With no keystroke at all, the Mac copy points at the menu bar icon, which
// opens its menu on one click; the PC copy keeps the tray double click.
assert(
  text(onboardingHotkeyCopy(null, "mac")) ===
    "No keyboard shortcut is free on this computer, so use the menu bar instead: click the Kavibay icon and choose Open to bring it back.",
  "the Mac no-gesture lesson names the menu bar and Open",
);
assert(
  text(onboardingHotkeyCopy(null, "pc")) ===
    "No keyboard shortcut is free on this computer, so use the tray instead: double-click the Kavibay icon next to the clock to bring it back.",
  "the PC no-gesture lesson names the tray",
);
assert(
  text(onboardingRevealHintCopy(null, "mac")) === text(onboardingHotkeyCopy(null, "mac")),
  "with no keystroke the hint and the lesson say the same thing",
);

// The Mac give-up copy names no cause: Secure Event Input was measured and does
// not block the monitor, and the Windows causes do not exist there.
const macFailedDoubleTap = text(onboardingHotkeyFallbackCopy("ctrlDoubleTap", "mac"));
assert(
  macFailedDoubleTap ===
    "The double tap on ⌃ Control didn't come through. Two ways in that always work: click the Kavibay icon in the menu bar and choose Open, or hold Ctrl+Space for a peek at your widgets.",
  "the Mac double-tap fallback says the tap did not arrive and names the menu bar",
);
assert(!macFailedDoubleTap.includes("administrator"), "the Mac fallback names no elevated window");
assert(!macFailedDoubleTap.includes("remote session"), "the Mac fallback names no remote session");
assert(!macFailedDoubleTap.includes("double-click"), "the Mac fallback asks for no double click");
assert(
  text(failedDoubleTap) ===
    "The double tap didn't come through. Kavibay can't see the keyboard while an app running as administrator or a remote session has focus. Two ways in that always work: double-click the Kavibay icon in the tray, or hold Ctrl+Space for a peek at your widgets.",
  "the PC double-tap fallback names the Windows causes",
);
assert(
  text(onboardingHotkeyFallbackCopy("cursorHotkey", "mac")) ===
    "The shortcut didn't come through. Another program is probably using it. Two ways in that always work: click the Kavibay icon in the menu bar and choose Open, or hold Ctrl+Space for a peek at your widgets.",
  "the Mac accelerator fallback names the menu bar",
);

assert(waitingPlace("mac") === "the menu bar", "a Mac keeps Kavibay in the menu bar");
assert(waitingPlace("pc") === "the tray", "Windows keeps it in the tray");

console.log("onboardingCopy.assert.ts: ok");
