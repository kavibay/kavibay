/**
 * The one-time setup card that runs before the guided tour.
 *
 * Two things belong here and nowhere else in onboarding: the decisions a user
 * makes once, for the machine rather than for themselves. Autostart is the
 * whole reason the card exists — a launcher that is not running after the first
 * reboot is a launcher the user has lost, and no amount of tour polish fixes
 * that. Which display to cover is the other, and only when there is more than
 * one to choose between.
 *
 * Deliberately *not* a tour step. The tour teaches by having the user act, so
 * every one of its steps waits for a gesture and can be stepped back through;
 * this is a form, it is answered by reading it, and stepping back into it after
 * the tour has started would mean re-asking a question already answered. It
 * keeps its own key for the same reason: `replayOnboarding` resets the tour, and
 * replaying "do you want autostart" is not a refresher, it is a second prompt
 * for a setting that has lived in Settings ever since.
 */

/** localStorage key for the setup card's own progress. */
export const SETUP_STORAGE_KEY = "kavibay:setup-v1";

export type SetupState = {
  status: "pending" | "done";
};

/** Parse stored JSON; null when missing or unreadable. */
export function parseSetupState(raw: string | null): SetupState | null {
  if (raw == null || raw === "") return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SetupState>;
    if (parsed.status !== "pending" && parsed.status !== "done") return null;
    return { status: parsed.status };
  } catch {
    return null;
  }
}

/** Serialize for localStorage. */
export function serializeSetupState(state: SetupState): string {
  return JSON.stringify(state);
}

/**
 * Whether the card should open on this start.
 *
 * Only on a true first open, and only for someone the tour has not run for
 * either. `firstOpenConsumed` is the real gate — an existing install has that
 * marker set and never reaches the card. `tourStoredRaw` is the second lock on
 * the same door, for the case the marker is lost: the WebView has been caught
 * losing keys it reported as written, which is why the durable mirror exists,
 * and a build that greets a long-time user by asking them to configure startup
 * reads as the app having forgotten who they are. Pass every tour key that has
 * ever existed (see `ONBOARDING_LEGACY_STORAGE_KEYS`), or renumbering the tour
 * would silently re-open this card for everyone.
 */
export function shouldShowSetup(opts: {
  firstOpenConsumed: boolean;
  storedRaw: string | null;
  tourStoredRaw: string | null;
}): boolean {
  return opts.firstOpenConsumed && opts.storedRaw == null && opts.tourStoredRaw == null;
}

/** Fresh state for a card that is about to be shown. */
export function pendingSetupState(): SetupState {
  return { status: "pending" };
}

/** State once the user has answered — or dismissed — the card. */
export function completedSetupState(): SetupState {
  return { status: "done" };
}

/** True while the card should be painted. */
export function isSetupVisible(state: SetupState | null): boolean {
  return state?.status === "pending";
}

/**
 * The card's pages, in order: the machine questions, which AI to use, and the
 * keystroke that starts the tour.
 *
 * Three topics, three pages. The AI page is the one a user may leave
 * unanswered; the keystroke page closes the card, so the gesture it asks for
 * has to be on the last one.
 */
export const SETUP_PAGES = ["machine", "ai", "start"] as const;
export type SetupPage = (typeof SETUP_PAGES)[number];

/**
 * The page after `page`, or "finish" after the last one.
 *
 * Also what the reveal gesture does while the card is up: before the last
 * page it turns the page instead of closing the card, so someone pressing ahead
 * out of habit does not skip the questions unseen.
 */
export function nextSetupPage(page: SetupPage): SetupPage | "finish" {
  return SETUP_PAGES[SETUP_PAGES.indexOf(page) + 1] ?? "finish";
}

/** The page before `page`, or null on the first one. */
export function previousSetupPage(page: SetupPage): SetupPage | null {
  return SETUP_PAGES[SETUP_PAGES.indexOf(page) - 1] ?? null;
}

/**
 * Keeps a dragged setup card on screen.
 *
 * The card is draggable because the browser sign-in for an AI provider opens
 * behind Kavibay's always-on-top window, right where the card sits. It may move
 * anywhere, but never off screen: a card nobody can reach is a setup nobody can
 * finish. `card` is the card's rect *without* the offset applied.
 */
export function clampCardOffset(
  offset: { x: number; y: number },
  card: { left: number; top: number; width: number; height: number },
  screen: { width: number; height: number },
  margin = 8,
): { x: number; y: number } {
  const clamp = (value: number, min: number, max: number) =>
    Math.min(Math.max(value, min), Math.max(min, max));
  return {
    x: clamp(offset.x, margin - card.left, screen.width - margin - card.left - card.width),
    y: clamp(offset.y, margin - card.top, screen.height - margin - card.top - card.height),
  };
}
