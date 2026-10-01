/**
 * Run: npx tsx extensions/gallery/galleryLogic.assert.ts
 */
import {
  buildGalleryTiles,
  collectGalleryCategories,
  extensionIdFromIntroPath,
  filterGalleryTiles,
  type GalleryTile,
} from "./galleryLogic";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(
  extensionIdFromIntroPath("/extensions/notes/intro.mp4") === "notes",
  "posix path",
);
assert(
  extensionIdFromIntroPath("/extensions/moodist/intro.mp4") === "moodist",
  "moodist",
);
assert(extensionIdFromIntroPath("/extensions/notes/icon.svg") === null, "reject non-intro");

{
  const tiles = buildGalleryTiles(
    [
      {
        id: "snake",
        title: "Snake",
        description: "Game",
        categories: ["fun"],
        keywords: ["game"],
      },
      {
        id: "notes",
        title: "Notes",
        description: "Sticky notes with rich text.",
        categories: ["productivity"],
        keywords: ["notes", "notiz"],
      },
      {
        id: "pomodoro",
        title: "Pomodoro",
        description: "Focus timer.",
        categories: ["productivity"],
        keywords: ["focus"],
      },
      {
        id: "moodist",
        title: "Moodist",
        description: "Ambient sounds.",
        categories: ["tools"],
        keywords: ["sound"],
      },
      {
        id: "gallery",
        title: "Widget Gallery",
        description: "Browse widgets.",
        categories: ["tools"],
        keywords: ["gallery"],
      },
      {
        id: "clock",
        title: "Clock",
        description: "Tells time.",
        categories: ["tools"],
        keywords: ["time"],
      },
    ],
    {
      notes: "url-notes",
      pomodoro: "url-pomodoro",
      moodist: "url-moodist",
      gallery: "url-gallery",
    },
  );
  // gallery skipped; snake+clock included without video; videos first
  assert(tiles.length === 5, "all registry except gallery");
  assert(tiles.every((t) => t.id !== "gallery"), "gallery omitted");
  assert(
    tiles[0].id === "moodist" &&
      tiles[1].id === "notes" &&
      tiles[2].id === "pomodoro",
    "video tiles first (A→Z)",
  );
  assert(tiles[3].id === "clock" && tiles[3].videoUrl === null, "blank after videos");
  assert(tiles[4].id === "snake" && tiles[4].videoUrl === null, "snake blank");
  assert(tiles.find((t) => t.id === "notes")?.videoUrl === "url-notes", "notes has video");
  assert(
    tiles.find((t) => t.id === "notes")?.description === "Sticky notes with rich text.",
    "description from manifest",
  );

  const cats = collectGalleryCategories(tiles);
  assert(
    cats.length === 3 &&
      cats[0] === "fun" &&
      cats[1] === "productivity" &&
      cats[2] === "tools",
    "unique cats",
  );

  const byProd = filterGalleryTiles(tiles, "", "productivity");
  assert(byProd.length === 2 && byProd.every((t) => t.categories.includes("productivity")), "cat filter");

  const byQuery = filterGalleryTiles(tiles, "notiz", null);
  assert(byQuery.length === 1 && byQuery[0].id === "notes", "keyword search");

  const byTitle = filterGalleryTiles(tiles, "mood", null);
  assert(byTitle.length === 1 && byTitle[0].id === "moodist", "title search");

  const combined = filterGalleryTiles(tiles, "focus", "tools");
  assert(combined.length === 0, "query+wrong category → empty");

  const all = filterGalleryTiles(tiles, "  ", null);
  assert(all.length === 5, "blank query is All");
}

{
  const empty: GalleryTile[] = [];
  assert(collectGalleryCategories(empty).length === 0, "no cats");
  assert(filterGalleryTiles(empty, "x", "tools").length === 0, "empty filter");
}

{
  // Good first picks lead, in their own order, ahead of every video tile.
  const entry = (id: string, pick?: number) => ({
    id,
    title: id,
    description: "",
    categories: [],
    keywords: [],
    pick,
  });
  const order = buildGalleryTiles(
    [entry("alpha"), entry("zeta", 2), entry("beta"), entry("mid", 1)],
    { alpha: "a.mp4" },
  ).map((t) => t.id);
  assert(
    JSON.stringify(order) === JSON.stringify(["mid", "zeta", "alpha", "beta"]),
    `picks first by rank, then video, then A→Z (got ${order.join(",")})`,
  );
}

console.log("galleryLogic.assert.ts: ok");
