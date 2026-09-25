/**
 * What is already on the desk the first time somebody opens Kavibay.
 *
 * An empty desk is the worst thing a widget workspace can show a new user: the
 * product's whole claim is on the screen and none of it is visible, so the
 * first instruction has to be "go and find something", which is work before any
 * reward. Two or three cards already sitting there answer "what is this" before
 * the question is asked, and they turn every later lesson — drag it, pin it,
 * hide it — into something done to a card the user already has.
 *
 * # Why the extensions decide, not this file
 *
 * The obvious version of this is a list of ids in core. The project has already
 * been down that road: read the comment on `RegisteredExtension.enabledByDefault`,
 * which exists because such a list "had already drifted — it still named
 * `github-actions`, an extension that no longer exists, and nothing could have
 * noticed". Core is not supposed to know what is in `extensions/` (see
 * `builtinWidgetIds.ts` for the only two exceptions and why they are exceptions),
 * so `starter` is a manifest field: a widget says for itself that it is a
 * reasonable thing to meet Kavibay through, and this module only sorts and caps
 * what the registry reports.
 *
 * A widget that needs an account has nothing to offer here — it would spawn a
 * connect prompt, which is a chore wearing a card. Nothing enforces that; it is
 * the same PR-review boundary the rest of the manifest sits behind.
 */

/** What this module needs to know about a catalog entry. */
export interface StarterCandidate {
  id: string;
  /** Manifest `starter`: lower goes on the desk first. Absent = not a starter. */
  starter?: number;
  /** False when the extension ships switched off. */
  enabled: boolean;
  /** False for palette-only extensions that never make a card. */
  isWidget: boolean;
}

/**
 * Most cards a first run may place.
 *
 * Not a preference, a blast radius. Every starter is reviewed, but a desk is a
 * small screen and "one contributor's enthusiasm" should cost the new user at
 * most one card too many rather than a wall of them.
 */
export const STARTER_DESK_LIMIT = 4;

/**
 * The ids to place, in the order they should be added.
 *
 * Ties break on id so the first run is reproducible — two widgets claiming
 * `starter: 2` must not land in whatever order the module graph happened to
 * resolve them, or the same build greets two machines differently.
 */
export function starterDeskIds(candidates: readonly StarterCandidate[]): string[] {
  return candidates
    .filter((c) => c.isWidget && c.enabled && typeof c.starter === "number")
    .sort((a, b) => (a.starter ?? 0) - (b.starter ?? 0) || a.id.localeCompare(b.id))
    .slice(0, STARTER_DESK_LIMIT)
    .map((c) => c.id);
}

/**
 * Whether this widget would open behind a gate rather than showing anything.
 *
 * Only asked of `starter` claims, and it is why a claim is a request rather
 * than a grant. `widgetGate` decides the same thing per instance, but it needs
 * a placed instance to do it — and by then the card is on a new user's desk,
 * which is exactly what must not happen. This looks at the definition instead:
 * a widget wanting a provider opens as a connect prompt, and one with a
 * required configuration field opens as a form. Both are chores wearing a card,
 * and the first thing somebody sees must not be a chore.
 *
 * A manifest cannot talk its way past this, which is the point. The mistake it
 * catches is not malice, it is a widget that grew a required field two releases
 * after it was made a starter — nothing would have failed, and the only symptom
 * would have been a first run nobody on the project ever sees again.
 */
export function startsGated(widget: {
  requires?: { providers?: readonly unknown[] };
  configuration?: Record<string, { required?: boolean }>;
}): boolean {
  if ((widget.requires?.providers ?? []).length > 0) return true;
  return Object.values(widget.configuration ?? {}).some((field) => field.required === true);
}
