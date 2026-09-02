import type { OnboardingStep } from "./onboardingLogic";

/** One body fragment; `typed` marks the command the user should type. */
export type OnboardingBodySegment = { text: string; typed?: boolean };

export type OnboardingCopy = {
  title: string;
  segments: OnboardingBodySegment[];
};

const COPY: Record<OnboardingStep, OnboardingCopy> = {
  1: {
    title: "Hey — welcome to Kavibay",
    segments: [
      {
        text: "Your desk, your launcher, your little superpowers. Quick tour — about a minute — and you’ll feel at home.",
      },
    ],
  },
  2: {
    title: "Launch anything, fast",
    segments: [
      { text: "Your apps live right here. Try typing " },
      { text: "notepad", typed: true },
      { text: " — Kavibay finds it on your system." },
    ],
  },
  3: {
    title: "Explore widgets",
    segments: [
      { text: "This is where the fun stuff lives. Type " },
      { text: "widget gallery", typed: true },
      { text: " (or hit Widgets) and take a peek." },
    ],
  },
  4: {
    title: "Make it yours",
    segments: [
      {
        text: "See something you like? Add it — your desk starts to feel like home.",
      },
    ],
  },
  5: {
    title: "Put things where they belong",
    segments: [
      {
        text: "Grab the top strip and drag — arrange your desk however feels right.",
      },
    ],
  },
  6: {
    title: "Give it room to breathe",
    segments: [
      {
        text: "Need it bigger or tighter? Pull the bottom-right corner until it feels right.",
      },
    ],
  },
  7: {
    title: "Keep your favorites close",
    segments: [
      {
        text: "Pin a widget and it stays put when you tuck Kavibay away with a double tap on Ctrl — perfect for clocks and notes.",
      },
    ],
  },
  8: {
    title: "Clear the clutter",
    segments: [
      {
        text: "Not gone — just out of the way. Tap the eye to hide a widget; it’s waiting when you need it again.",
      },
    ],
  },
  9: {
    title: "Bring it back",
    segments: [
      {
        text: "Changed your mind? Search for the hidden widget and Show it — back on the desk in a flash.",
      },
    ],
  },
  10: {
    title: "Start fresh when you need to",
    segments: [
      {
        text: "Really done with a widget? Press and hold the eye until it becomes ×, then let go. That one’s gone for good — data included.",
      },
    ],
  },
  11: {
    title: "You’re all set",
    segments: [
      {
        text: "That’s the vibe. Tap Ctrl twice to show or hide Kavibay anytime, or hold Ctrl+Space for a peek at your widgets. Want a refresher later? Settings → Behavior → Replay tour.",
      },
    ],
  },
};

/**
 * Bubble copy for the active step.
 * Pass `hiddenWidgetName` on step 9 so the restore hint names the widget just hidden.
 */
export function onboardingCopyForStep(
  step: OnboardingStep,
  opts?: { hiddenWidgetName?: string | null },
): OnboardingCopy {
  if (step === 9) {
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
  return COPY[step];
}
