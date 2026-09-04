/**
 * The two catalog ids core itself drives, in one place.
 *
 * Core is not supposed to know what is in `extensions/`, and everywhere else it
 * does not: the catalog, the palette, the layout and Settings all work off
 * `RegisteredExtension` and never name a folder. These two are the exceptions,
 * and they are exceptions because the dependency runs the other way — a core
 * feature *is* the reason the widget exists, not the other way round:
 *
 * - The Widget Gallery is how the app adds widgets at all. The palette's
 *   `open-gallery` command opens it, and the guided tour teaches with it.
 * - The Widget Wizard is the AI builder's entry point, opened from the plus
 *   button next to the palette.
 *
 * Naming them here does not remove the coupling — it makes it one greppable
 * fact instead of fourteen string literals spread over the host, the palette
 * and the onboarding coach, where a rename would have been found by whichever
 * one broke first. If either widget is ever generalised into a contribution the
 * runtime resolves, this file is the list of callers to revisit.
 */

/** Catalog id of the Widget Gallery. */
export const GALLERY_WIDGET_ID = "gallery";

/** Catalog id of the Widget Wizard. */
export const WIDGET_WIZARD_ID = "widget-wizard";

/**
 * Whether a placed tile is the gallery.
 *
 * Used almost entirely to *exclude* it: the tour teaches by having the user act
 * on a widget they added from the gallery, so the gallery's own move, resize,
 * pin and remove events are the scenery, not the lesson.
 */
export function isGalleryWidget(typeId: string | null | undefined): boolean {
  return typeId === GALLERY_WIDGET_ID;
}
