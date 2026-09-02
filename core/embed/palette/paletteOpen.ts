import type { DemoKind, DemoRow } from "./demoRows";

/**
 * Fired when the visitor runs a demo row (Enter or click). `composed` so it
 * crosses the palette's shadow tree; a sibling card on the page can listen
 * on `document` without the two elements importing each other.
 */
export const PALETTE_OPEN_EVENT = "kavibay-palette-open";

export interface PaletteOpenDetail {
  id: string;
  kind: DemoKind;
}

export function paletteOpenDetail(row: DemoRow): PaletteOpenDetail {
  return { id: row.id, kind: row.kind };
}

export function isPaletteOpenEvent(event: Event): event is CustomEvent<PaletteOpenDetail> {
  return event.type === PALETTE_OPEN_EVENT;
}

/**
 * Whether a run of `detail` should reveal the card a page tagged with `rowId`
 * (`<kavibay-widget opens-on="clock">`).
 *
 * The `kind` check is not decoration: app rows and widget rows share an id
 * space, and "Enter on the Chrome row" must not open a widget that happens to
 * be called the same thing.
 *
 * `action` counts as well, because that is what a contributed action does: the
 * Wizard's "New Widget" opens the Wizard. A `command` or an `app` never does.
 */
export function opensWidget(detail: PaletteOpenDetail, rowId: string): boolean {
  return (detail.kind === "widget" || detail.kind === "action") && detail.id === rowId;
}
