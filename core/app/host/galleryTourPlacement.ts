/**
 * Where the Widget Gallery goes, and where the things it opens go.
 *
 * Two placements that only make sense together: the gallery takes the band
 * directly above the palette, so whatever it opens has to land somewhere that
 * band does not cover — and the obvious somewhere is the other side of the
 * palette, where the new card is visible the moment it appears instead of
 * arriving behind the panel that spawned it.
 */

/**
 * Where the Widget Gallery opens while the tour is teaching it.
 *
 * Everywhere else the gallery is an ordinary card: it takes the size in its
 * manifest, spawns near the palette and gets pushed clear of whatever is
 * already there. That is right for someone reaching for it on a desk they have
 * arranged, and wrong for the one moment the tour points an arrow at it — a
 * 720-wide panel landing wherever there happened to be room reads as a card
 * that appeared *near* the launcher rather than as the launcher opening up.
 *
 * So for that one step it is placed deliberately: the palette's own width,
 * directly above it, one grid gap away. The two then read as a single surface,
 * which is also what makes the coach's arrow short and unambiguous.
 *
 * The height is the only thing that can fail. The gallery wants 480, and above
 * a centred palette on a 720-tall window there is nowhere near that much room —
 * so it takes what is there, and gives up rather than shrink past the point of
 * being a gallery at all. Giving up returns `null`, which puts the card back on
 * the ordinary spawn path: a gallery somewhere sensible beats a 90-pixel strip
 * in the right place.
 */

/** Below this a gallery of video previews is not one; fall back instead. */
export const GALLERY_TOUR_MIN_HEIGHT = 240;

export interface GalleryTourPlacement {
  /** Offset from the palette centre, the space `onAddType` spawns in. */
  offset: { x: number; y: number };
  size: { w: number; h: number };
}

export function galleryTourPlacement(opts: {
  /** Palette width in CSS px — the width the gallery takes. */
  paletteWidth: number;
  /** Measured palette height; the gallery sits a gap above it. */
  paletteHeight: number;
  /** Screen y of the palette's centre. */
  paletteCentreY: number;
  /** Height the gallery would open at normally (manifest or remembered). */
  preferredHeight: number;
  viewportHeight: number;
  /** Keep-out band at the viewport edge. */
  margin: number;
  gap: number;
}): GalleryTourPlacement | null {
  const {
    paletteWidth,
    paletteHeight,
    paletteCentreY,
    preferredHeight,
    viewportHeight,
    margin,
    gap,
  } = opts;

  if (!(paletteWidth > 0) || !(viewportHeight > 0)) return null;

  // Everything between the top margin and the palette's top edge, less the gap.
  const room = paletteCentreY - paletteHeight / 2 - gap - margin;
  const height = Math.min(preferredHeight, room);
  if (!(height >= GALLERY_TOUR_MIN_HEIGHT)) return null;

  return {
    offset: { x: 0, y: -(paletteHeight / 2 + gap + height / 2) },
    size: { w: Math.round(paletteWidth), h: Math.round(height) },
  };
}

/**
 * Where a widget picked in the gallery opens: left of the palette, level with it.
 *
 * The gallery is palette-width and sits above the palette, so anything landing
 * near the palette's own centre opens *under* it — the user clicks Add and
 * nothing appears to happen. Left is the free side by construction: the gallery
 * occupies the band above, and the ordinary de-overlap stacks the second and
 * third pick outward from here.
 *
 * Returns an offset from the palette centre, in the space `onAddType` spawns
 * in. Null when the palette has no width worth measuring yet.
 */
export function galleryPickOffset(opts: {
  paletteWidth: number;
  /** Snapped spawn width of the widget being opened. */
  widgetWidth: number;
  gap: number;
}): { x: number; y: number } | null {
  const { paletteWidth, widgetWidth, gap } = opts;
  if (!(paletteWidth > 0) || !(widgetWidth > 0)) return null;
  return { x: -(paletteWidth / 2 + gap + widgetWidth / 2), y: 0 };
}
