/**
 * Run: npx tsx core/app/host/galleryTourPlacement.assert.ts
 */
import {
  galleryPickOffset,
  galleryTourPlacement,
  GALLERY_TOUR_MIN_HEIGHT,
  type GalleryTourPlacement,
} from "./galleryTourPlacement";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

/** A roomy desktop with the palette centred, which is the ordinary case. */
function opts(over: Partial<Parameters<typeof galleryTourPlacement>[0]> = {}) {
  return {
    paletteWidth: 640,
    paletteHeight: 118,
    paletteCentreY: 540,
    preferredHeight: 480,
    viewportHeight: 1080,
    margin: 24,
    gap: 15,
    ...over,
  };
}

/** Top edge of the gallery in screen space, given its offset from the palette. */
function topEdge(p: GalleryTourPlacement, paletteCentreY: number): number {
  return paletteCentreY + p.offset.y - p.size.h / 2;
}

/** Bottom edge of the gallery in screen space. */
function bottomEdge(p: GalleryTourPlacement, paletteCentreY: number): number {
  return paletteCentreY + p.offset.y + p.size.h / 2;
}

const roomy = galleryTourPlacement(opts());
assert(roomy != null, "a roomy desktop gets a placement");
assert(roomy.size.w === 640, "the gallery takes the palette's width");
assert(roomy.offset.x === 0, "it is centred on the palette");
// 1080 tall with the palette centred leaves 442, not the manifest's 480: above
// a centred palette there is always less than half the screen, so the height
// asked for is the ceiling and almost never the answer.
assert(roomy.size.h === 442, "it takes the room above the palette");
assert(roomy.size.h < 480, "…which is less than the manifest asks for");

// The full height is only reached when the palette has been dragged low.
const lowPalette = galleryTourPlacement(opts({ paletteCentreY: 800 }));
assert(lowPalette?.size.h === 480, "a low palette leaves room for the full height");

// The whole point: it sits above the palette, exactly one gap clear of it.
assert(
  bottomEdge(roomy, 540) === 540 - 118 / 2 - 15,
  "the gallery's bottom edge is one gap above the palette's top edge",
);
assert(topEdge(roomy, 540) >= 24, "and it stays inside the top margin");

// A palette that has been widened takes the gallery with it.
const wide = galleryTourPlacement(opts({ paletteWidth: 900 }));
assert(wide?.size.w === 900, "a widened palette widens the gallery");

// Short window: the gallery gives up height rather than the position.
const short = galleryTourPlacement(opts({ viewportHeight: 720, paletteCentreY: 360 }));
assert(short != null, "a short window still gets a placement");
assert(short.size.h < 480, "…by shrinking");
assert(
  bottomEdge(short, 360) === 360 - 118 / 2 - 15,
  "the gap above the palette is what does not move",
);
assert(topEdge(short, 360) >= 24, "and the top margin is still respected");

// Too short to be a gallery: fall back to the ordinary spawn path instead of
// opening a strip. `null` is the caller's signal to do nothing special.
assert(
  galleryTourPlacement(opts({ paletteCentreY: 200 })) === null,
  "no room means no special placement",
);
const exactly = galleryTourPlacement(
  opts({ paletteCentreY: 24 + GALLERY_TOUR_MIN_HEIGHT + 15 + 118 / 2 }),
);
assert(exactly?.size.h === GALLERY_TOUR_MIN_HEIGHT, "the minimum height is usable");
assert(
  galleryTourPlacement(opts({ paletteCentreY: 24 + GALLERY_TOUR_MIN_HEIGHT + 15 + 118 / 2 - 1 })) ===
    null,
  "one pixel less is not",
);

// Degenerate inputs are a "no", never a NaN offset written into a layout.
assert(galleryTourPlacement(opts({ paletteWidth: 0 })) === null, "no palette width, no placement");
assert(
  galleryTourPlacement(opts({ viewportHeight: 0 })) === null,
  "no viewport height, no placement",
);

// A pick from the gallery opens on the free side of the palette. The gallery
// itself covers the band above (same width, centred), so anything opening at
// its own manifest offset can land behind the panel that spawned it — which is
// Add appearing to do nothing.
const pick = galleryPickOffset({ paletteWidth: 640, widgetWidth: 280, gap: 15 });
assert(pick != null, "a pick gets an offset");
assert(pick.y === 0, "level with the palette");
assert(pick.x === -(320 + 15 + 140), "one gap left of the palette's left edge");
assert(pick.x < 0, "left, not right — right is where the starters live");

// Its right edge is exactly one gap from the palette's left edge, whatever the
// widget's width: that is what "left of the palette" has to mean.
for (const widgetWidth of [180, 280, 520]) {
  const p = galleryPickOffset({ paletteWidth: 640, widgetWidth, gap: 15 });
  assert(p != null, `offset for width ${widgetWidth}`);
  assert(p.x + widgetWidth / 2 === -(640 / 2) - 15, `right edge clears the palette (${widgetWidth})`);
}

// A widened palette pushes picks further out, so they never land under it.
const wider = galleryPickOffset({ paletteWidth: 900, widgetWidth: 280, gap: 15 });
assert(wider != null && wider.x < pick.x, "a wider palette moves picks further left");

// Nothing measurable yet is a "no", never a NaN offset in a layout.
assert(galleryPickOffset({ paletteWidth: 0, widgetWidth: 280, gap: 15 }) === null, "no palette, no offset");
assert(galleryPickOffset({ paletteWidth: 640, widgetWidth: 0, gap: 15 }) === null, "no widget, no offset");

// The two placements must not collide: the gallery owns the band above the
// palette, a pick owns the strip to its left.
const band = galleryTourPlacement(opts());
assert(band != null, "gallery band");
const bandLeft = -band.size.w / 2;
assert(
  pick.x + 280 / 2 <= bandLeft,
  "a pick's right edge stays clear of the gallery band's left edge",
);

console.log("galleryTourPlacement.assert.ts: ok");
