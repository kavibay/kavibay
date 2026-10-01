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
 * Fixed copy, by step.
 *
 * One voice throughout, here and on the setup card: plain, warm, second
 * person, short sentences. No jokes and no idioms — the copy is read once, by
 * somebody deciding whether to keep the app, and often not in their first
 * language.
 *
 * Two steps are absent on purpose: the hotkey step, whose text depends on which
 * keystroke the host reports (`onboardingHotkeyCopy`), and the ending card
 * (`onboardingDoneCopy`).
 */
const fixedCopy: Record<Exclude<OnboardingStep, 2 | 6>, OnboardingCopy> = {
  1: {
    title: "Welcome to Kavibay",
    segments: [
      {
        text: "Your launcher and your widgets, one keystroke away. This tour takes about a minute.",
      },
    ],
  },
  3: {
    title: "Launch anything",
    segments: [
      { text: "Your apps are right here. Type " },
      { text: "notepad", typed: true },
      { text: " and Kavibay finds it." },
    ],
  },
  4: {
    title: "Find a widget",
    segments: [
      { text: "Widgets live in the gallery. Type " },
      { text: "widget gallery", typed: true },
      { text: " or click Widgets." },
    ],
  },
  5: {
    title: "Add one",
    segments: [{ text: "Pick a widget you like and click Add. It goes on your desk." }],
  },
};

/** Where a started Kavibay waits: the Windows tray or the macOS menu bar. */
export function waitingPlace(platform: KeyPlatform): string {
  return platform === "mac" ? "the menu bar" : "the tray";
}

/**
 * The tray route when no keystroke exists, in the click this platform's icon
 * answers to. The Windows tray icon opens on a double click; the macOS menu bar
 * icon opens its menu on a single click, and the menu's Open item does the rest.
 */
const TRAY_ONLY: Record<KeyPlatform, string> = {
  pc: "use the tray instead: double-click the Kavibay icon next to the clock to bring it back.",
  mac: "use the menu bar instead: click the Kavibay icon and choose Open to bring it back.",
};

/**
 * The card that ends the tour.
 *
 * An ending first: the user has reached Kavibay with the keyboard, launched
 * something and put a widget on the desk, which is the whole product working.
 * Then the one thing other launchers cannot do — the card's second button opens
 * the Widget Wizard — and where the tour lives if they want it again, since
 * nothing else on screen says so.
 */
export function onboardingDoneCopy(): OnboardingCopy {
  return {
    title: "You've got the basics",
    segments: [
      {
        text: "Reach Kavibay from any app, launch anything, keep widgets on your desk. Missing a widget? Describe it and Kavibay builds it for you. To see this tour again, search for ",
      },
      { text: "Replay Tour", typed: true },
      { text: "." },
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
  afterSetupGesture = false,
): OnboardingCopy {
  if (gesture === "cursorHotkey") {
    return {
      title: "First, the way back in",
      segments: [
        { text: "Press " },
        { text: "Shift+Ctrl+Space", typed: true },
        {
          text: " and everything disappears, this card included. Press it again and it's all back. That's how you reach Kavibay from any app.",
        },
      ],
    };
  }
  if (gesture === null) {
    return {
      title: "First, the way back in",
      segments: [
        {
          text: `No keyboard shortcut is free on this computer, so ${TRAY_ONLY[platform]}`,
        },
      ],
    };
  }
  // The one step whose instructions have to survive the screen going blank: the
  // gesture hides everything, this card included, so the promise that it all
  // comes back has to be read *before* it happens. Somebody who taps twice
  // expecting a menu and gets an empty desktop thinks they closed the app.
  const key = doubleTapKeyLabel(platform);
  // Answering the setup card with the double tap already taught the gesture;
  // what is left is the round trip, so the card picks up from there.
  if (afterSetupGesture) {
    return {
      title: "That's the one",
      segments: [
        { text: "Now the round trip. Tap " },
        { text: key, typed: true },
        { text: " twice and everything disappears, this card included. Tap it twice again and it's all back." },
      ],
    };
  }
  return {
    title: "First, the way back in",
    segments: [
      { text: "Tap " },
      { text: key, typed: true },
      { text: " twice and everything disappears, this card included. Tap " },
      { text: key, typed: true },
      { text: " twice again and it's all back. That's how you reach Kavibay from any app." },
    ],
  };
}

/**
 * The one line the welcome card cannot leave out.
 *
 * The setup card's fallback for machines without the Ctrl double tap. Where
 * the double tap exists the card asks for it instead, and the gesture starts
 * the tour (see `setupGestureCount`). Either way the card is the only place
 * everybody passes through. Somebody who takes `Skip the tour` never
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
          text: " in any app to bring Kavibay up. Press it again to put everything away.",
        },
      ],
    };
  }
  if (gesture === null) {
    return {
      title: "The one thing to remember",
      segments: [
        {
          text: `No keyboard shortcut is free on this computer, so ${TRAY_ONLY[platform]}`,
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
        text: " twice in any app to bring Kavibay up. Tap it twice again to put everything away.",
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
      ? "The shortcut didn't come through. Another program is probably using it. "
      : platform === "mac"
        ? "The double tap on ⌃ Control didn't come through. "
        : "The double tap didn't come through. Kavibay can't see the keyboard while an app running as administrator or a remote session has focus. ";
  const trayRoute =
    platform === "mac"
      ? "click the Kavibay icon in the menu bar and choose Open"
      : "double-click the Kavibay icon in the tray";
  return {
    title: "Kavibay didn't get that",
    segments: [
      { text: `${cause}Two ways in that always work: ${trayRoute}, or hold ` },
      { text: "Ctrl+Space", typed: true },
      { text: " for a peek at your widgets." },
    ],
  };
}

/** Bubble copy for the active step. */
export function onboardingCopyForStep(
  step: OnboardingStep,
  platform: KeyPlatform,
  opts?: { revealGesture?: RevealGesture | null; afterSetupGesture?: boolean },
): OnboardingCopy {
  if (step === 2) {
    return onboardingHotkeyCopy(opts?.revealGesture ?? null, platform, opts?.afterSetupGesture);
  }
  if (step === 6) return onboardingDoneCopy();
  return fixedCopy[step];
}
