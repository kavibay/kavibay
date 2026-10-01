import { ref } from "vue";
import { onboardingState } from "./onboardingSession";

/**
 * One-time tips for widget chrome, shown the first time somebody reaches for it.
 *
 * They replace six tour lessons (move, resize, pin, hide, restore, delete) that
 * taught chrome to somebody who had owned a widget for forty seconds. A tip at
 * the moment of use teaches the same thing to somebody who now cares.
 *
 * Armed on the first open, like `backgroundHint`: profiles that predate the
 * tips know the cards, and greeting them with "drag the top strip" reads as
 * the app having forgotten who they are.
 */

export type FirstTimeTip = { id: TipId; title: string; body: string };
type TipId = "widget-chrome" | "widget-pinned" | "widget-hidden";

/** `{ armed: true, seen: [...] }` once armed; absent for older profiles. */
const TIPS_KEY = "kavibay:first-time-tips";
/** Long enough to read two lines, short enough not to become furniture. */
const TIP_MS = 9000;

export const activeTip = ref<FirstTimeTip | null>(null);
let hideTimer: ReturnType<typeof setTimeout> | undefined;

function readSeen(): Set<TipId> | null {
  try {
    const raw = localStorage.getItem(TIPS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { seen?: unknown };
    return new Set(Array.isArray(parsed.seen) ? (parsed.seen as TipId[]) : []);
  } catch {
    return null;
  }
}

function writeSeen(seen: Set<TipId>): void {
  try {
    localStorage.setItem(TIPS_KEY, JSON.stringify({ seen: [...seen] }));
  } catch {
    // Blocked storage: the tip may come again, which is the harmless failure.
  }
}

/** Start offering tips on this profile. Call on the first open only. */
export function armFirstTimeTips(): void {
  if (readSeen() == null) writeSeen(new Set());
}

/** Show `tip` unless it was shown before, tips are not armed, or the tour is talking. */
function showOnce(tip: FirstTimeTip): void {
  if (onboardingState.value?.status === "active") return;
  const seen = readSeen();
  if (seen == null || seen.has(tip.id)) return;
  seen.add(tip.id);
  writeSeen(seen);
  activeTip.value = tip;
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    if (activeTip.value?.id === tip.id) activeTip.value = null;
  }, TIP_MS);
}

/** First time a card's chrome shows: how to arrange it, and where the rest lives. */
export function showWidgetChromeTip(): void {
  showOnce({
    id: "widget-chrome",
    title: "Make it fit",
    body: "Drag the top strip to move a widget and pull its corner to resize it. Rename and delete are in the ⋯ menu.",
  });
}

export function showWidgetPinnedTip(): void {
  showOnce({
    id: "widget-pinned",
    title: "Pinned",
    body: "This widget stays on screen when you hide Kavibay. Pin it again to let it go.",
  });
}

/**
 * Hidden is not deleted, and the difference is the thing worth saying — the ×
 * looks like it throws the widget away.
 */
export function showWidgetHiddenTip(name: string): void {
  showOnce({
    id: "widget-hidden",
    title: `${name} is hidden, not deleted`,
    body: "Search for it to bring it back. To delete a widget for good, use the ⋯ menu.",
  });
}
