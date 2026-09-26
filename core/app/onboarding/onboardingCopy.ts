import type { RevealGesture } from "../host/revealGesture";
import { doubleTapKeyLabel, type KeyPlatform } from "../host/shortcutHints";
import type { OnboardingStep } from "./onboardingLogic";

/** One body fragment; `typed` marks the command the user should type. */
export type OnboardingBodySegment = { text: string; typed?: boolean };

export type OnboardingCopy = {
  title: string;
  segments: OnboardingBodySegment[];
};

/**
 * Fixed copy, by step, for the keyboard this machine has.
 *
 * Two steps are absent on purpose: the hotkey step, whose text depends on which
 * keystroke the host reports (`onboardingHotkeyCopy`), and the core card, which
 * is a branch rather than a lesson (`onboardingCoreDoneCopy`).
 */
const fixedCopy = (
  platform: KeyPlatform,
): Record<Exclude<OnboardingStep, 2 | 6>, OnboardingCopy> => ({
  1: {
    title: "Hey — welcome to Kavibay",
    segments: [
      {
        text: "Your desk, your launcher, your little superpowers. Quick tour — about a minute — and you’ll feel at home.",
      },
    ],
  },
  3: {
    title: "Launch anything, fast",
    segments: [
      { text: "Your apps live right here. Try typing " },
      { text: "notepad", typed: true },
      { text: " — Kavibay finds it on your system." },
    ],
  },
  4: {
    title: "Explore widgets",
    segments: [
      { text: "This is where the fun stuff lives. Type " },
      { text: "widget gallery", typed: true },
      { text: " (or hit Widgets) and take a peek." },
    ],
  },
  5: {
    title: "Make it yours",
    segments: [
      {
        text: "See something you like? Add it — your desk starts to feel like home.",
      },
    ],
  },
  7: {
    title: "Put things where they belong",
    segments: [
      {
        text: "Grab the top strip and drag — arrange your desk however feels right.",
      },
    ],
  },
  8: {
    title: "Give it room to breathe",
    segments: [
      {
        text: "Need it bigger or tighter? Pull the bottom-right corner until it feels right.",
      },
    ],
  },
  9: {
    title: "Keep your favorites close",
    segments: [
      {
        text: `Pin a widget and it stays put when you tuck Kavibay away with a double tap on ${doubleTapKeyLabel(platform)} — perfect for clocks and notes.`,
      },
    ],
  },
  10: {
    title: "Clear the clutter",
    segments: [
      {
        text: "Not gone — just out of the way. Tap the eye to hide a widget; it’s waiting when you need it again.",
      },
    ],
  },
  11: {
    title: "Bring it back",
    segments: [
      {
        text: "Changed your mind? Search for the hidden widget and Show it — back on the desk in a flash.",
      },
    ],
  },
  12: {
    title: "Start fresh when you need to",
    segments: [
      {
        text: "Really done with a widget? Press and hold the eye until it becomes ×, then let go. That one’s gone for good — data included.",
      },
    ],
  },
  13: {
    title: "Now you know the lot",
    segments: [
      {
        text: "Your desk, your rules. Everything here is in Settings → Behavior if you want it again.",
      },
    ],
  },
});

/**
 * The tray route when no keystroke exists, in the click this platform's icon
 * answers to. The Windows tray icon opens on a double click; the macOS menu bar
 * icon opens its menu on a single click, and the menu's Open item does the rest.
 */
const TRAY_ONLY: Record<KeyPlatform, string> = {
  pc: "the tray is your way in: double-click the Kavibay icon down by the clock and the desk comes back.",
  mac: "the menu bar is your way in: click the Kavibay icon up there and choose Open, and the desk comes back.",
};

/**
 * The card that ends the core tour.
 *
 * Deliberately an ending first and an offer second. The user has reached
 * Kavibay with the keyboard, launched something and put a widget on the desk —
 * that is the whole product working, and saying so is more useful than treating
 * it as the fifth of eleven things. The six lessons behind it are real but they
 * are housekeeping, and housekeeping is worth learning when you have something
 * to keep house for.
 */
export function onboardingCoreDoneCopy(): OnboardingCopy {
  return {
    title: "That is the whole idea",
    segments: [
      {
        text: "You can reach Kavibay from anywhere, launch anything, and put widgets on your desk. Go and use it — or take one more minute and learn to arrange, pin and clear the cards.",
      },
    ],
  };
}

/**
 * The hotkey step's instruction for whichever keystroke this machine has.
 *
 * Kept beside the copy record rather than in it because the step is the one
 * whose text depends on the host: `revealGesture` decides, and a `fixedCopy`
 * entry would have to be one of the three answers pretending to be all of them.
 */
export function onboardingHotkeyCopy(
  gesture: RevealGesture | null,
  platform: KeyPlatform,
): OnboardingCopy {
  if (gesture === "cursorHotkey") {
    return {
      title: "First, the way back in",
      segments: [
        { text: "Press " },
        { text: "Shift+Ctrl+Space", typed: true },
        {
          text: " — everything disappears, this card included. Press it again and it is all back. That is how you reach Kavibay from anywhere.",
        },
      ],
    };
  }
  if (gesture === null) {
    return {
      title: "First, the way back in",
      segments: [
        {
          text: `No keyboard shortcut is free on this machine, so ${TRAY_ONLY[platform]} Worth knowing before anything else.`,
        },
      ],
    };
  }
  // The one step whose instructions have to survive the screen going blank: the
  // gesture hides everything, this card included, so the promise that it all
  // comes back has to be read *before* it happens. Somebody who taps twice
  // expecting a menu and gets an empty desktop thinks they closed the app.
  const key = doubleTapKeyLabel(platform);
  return {
    title: "First, the only key that matters",
    segments: [
      { text: "Tap " },
      { text: key, typed: true },
      { text: " twice — everything disappears, this card included. Tap " },
      { text: key, typed: true },
      { text: " twice again and it is all back. That is how you reach Kavibay from anywhere." },
    ],
  };
}

/**
 * The one line the welcome card cannot leave out.
 *
 * A statement, not the instruction `onboardingHotkeyCopy` gives: the card is
 * not the place to practise the gesture — performing it there would hide the
 * card before its autostart answer has been committed — but it is the only
 * place everybody passes through. Somebody who takes `Skip the tour` never
 * reaches the lesson, and without this they have just been handed an app they
 * cannot find again.
 *
 * Same three branches as the lesson, and for the same reason: naming a key this
 * machine cannot deliver is worse than naming none.
 */
export function onboardingRevealHintCopy(
  gesture: RevealGesture | null,
  platform: KeyPlatform,
): OnboardingCopy {
  if (gesture === "cursorHotkey") {
    return {
      title: "The one thing to remember",
      segments: [
        { text: "Press " },
        { text: "Shift+Ctrl+Space", typed: true },
        {
          text: " any time, in any app — that brings Kavibay up. Press it again and everything is out of the way.",
        },
      ],
    };
  }
  if (gesture === null) {
    return {
      title: "The one thing to remember",
      segments: [
        {
          text: `No keyboard shortcut was free on this machine, so ${TRAY_ONLY[platform]}`,
        },
      ],
    };
  }
  return {
    title: "The one thing to remember",
    segments: [
      { text: "Tap " },
      { text: doubleTapKeyLabel(platform), typed: true },
      {
        text: " twice, any time, in any app — that brings Kavibay up. Tap it twice again and everything is out of the way.",
      },
    ],
  };
}

/**
 * What the hotkey step says once its keystroke has been given up on.
 *
 * Reached when the tour brought the window back by itself: the user pressed to
 * hide Kavibay — which the webview handles on its own and always works — and
 * then nothing came back, because the shortcut never arrived. For the double
 * tap on Windows that is the `WH_KEYBOARD_LL` hook going uncalled behind an
 * elevated window, an RDP session or some game overlays, and the copy says so.
 * On macOS the double tap comes from an `NSEvent` global monitor, and no
 * blocker is known: Secure Event Input (password fields, Secure Keyboard Entry)
 * was measured and does not stop `flagsChanged` from arriving. Naming a cause
 * there would send the user hunting for one, so the copy only says the double
 * tap did not arrive. For Shift+Ctrl+Space it is a global accelerator that
 * another program is holding. Either way the copy does not repeat the gesture,
 * it names the ways in that do not depend on it, and the tray route is the one
 * the platform's icon answers to: a double click in the Windows tray, a single
 * click and Open in the macOS menu bar.
 */
export function onboardingHotkeyFallbackCopy(
  gesture: RevealGesture | null,
  platform: KeyPlatform,
): OnboardingCopy {
  const cause =
    gesture !== "ctrlDoubleTap"
      ? "That shortcut did not reach me; another program is most likely holding it. "
      : platform === "mac"
        ? "The double tap on ⌃ Control never made it through to me. "
        : "The double tap needs to see your keyboard, and something on this machine is keeping it from me — an elevated window or a remote session will do that. ";
  const trayRoute =
    platform === "mac"
      ? "click the Kavibay icon in the menu bar and choose Open"
      : "double-click the Kavibay icon in the tray";
  return {
    title: "That one did not reach me",
    segments: [
      { text: `${cause}Two ways in that always work: ${trayRoute}, or hold ` },
      { text: "Ctrl+Space", typed: true },
      { text: " for a peek at your widgets." },
    ],
  };
}

/**
 * Bubble copy for the active step.
 * Pass `hiddenWidgetName` on the restore step so the hint names the widget just hidden.
 */
export function onboardingCopyForStep(
  step: OnboardingStep,
  platform: KeyPlatform,
  opts?: { hiddenWidgetName?: string | null; revealGesture?: RevealGesture | null },
): OnboardingCopy {
  if (step === 2) return onboardingHotkeyCopy(opts?.revealGesture ?? null, platform);
  if (step === 6) return onboardingCoreDoneCopy();
  if (step === 11) {
    const name = opts?.hiddenWidgetName?.trim();
    if (name) {
      return {
        title: "Bring it back",
        segments: [
          { text: "Search for " },
          { text: name, typed: true },
          { text: " and Show it — back on the desk in a flash." },
        ],
      };
    }
  }
  return fixedCopy(platform)[step];
}
