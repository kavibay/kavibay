<script setup lang="ts">
/**
 * Desk widget: catalog of all extensions (3 columns, auto rows). Tiles are 4:3;
 * intro.mp4 plays when present, otherwise the media area stays blank.
 * Sonderform entry points live in the host (+ menu / first-open); this is a normal card.
 */
import { computed, inject, ref } from "vue";
import {
  buildGalleryTiles,
  collectGalleryCategories,
  filterGalleryTiles,
  type GalleryRegistryEntry,
} from "./galleryLogic";
import { introVideoById } from "./introVideos";
import { useLazyIntroVideos } from "./useLazyIntroVideos";

/** Tiles only decode their intro while on screen — see useLazyIntroVideos. */
const { vLazyIntro } = useLazyIntroVideos();

/** Host create path — gallery stays open after Add so several widgets can be placed. */
const addWidget = inject<
  (
    typeId: string,
    opts?: { screen?: { x: number; y: number }; origin?: "gallery" },
  ) => string | undefined
>("kavibayAddWidget");
const focusWidget = inject<(instanceId: string) => void | Promise<void>>("kavibayFocusWidget");

const query = ref("");
/** `null` = All categories. */
const activeCategory = ref<string | null>(null);

/** Catalog fields from sibling manifests (extensions may not import core/). */
const manifestModules = import.meta.glob("/extensions/*/manifest.json", {
  eager: true,
  import: "default",
}) as Record<
  string,
  {
    format?: string;
    id?: string;
    name?: string;
    displayName?: string;
    description?: string;
    widgets?: Record<
      string,
      {
        replaces?: string;
        categories?: string[];
        keywords?: string[];
      }
    >;
    categories?: string[];
    keywords?: string[];
  }
>;

function titleFromWidgetId(id: string): string {
  return id
    .split("-")
    .filter(Boolean)
    .map((part) => (part.toLowerCase() === "github" ? "GitHub" : part[0]?.toUpperCase() + part.slice(1)))
    .join(" ");
}

const registryLite = computed((): GalleryRegistryEntry[] => {
  const rows: GalleryRegistryEntry[] = [];
  for (const raw of Object.values(manifestModules)) {
    if (!raw) continue;

    if (raw.format === "contract" && typeof raw.name === "string" && raw.widgets) {
      for (const [widgetName, widget] of Object.entries(raw.widgets)) {
        const id = typeof widget.replaces === "string" ? widget.replaces : widgetName;
        rows.push({
          id,
          title: widgetName === raw.name ? raw.displayName ?? titleFromWidgetId(id) : titleFromWidgetId(id),
          description: typeof raw.description === "string" ? raw.description : "",
          categories: Array.isArray(widget.categories)
            ? widget.categories.filter((c): c is string => typeof c === "string")
            : Array.isArray(raw.categories)
              ? raw.categories.filter((c): c is string => typeof c === "string")
              : [],
          keywords: Array.isArray(widget.keywords)
            ? widget.keywords.filter((k): k is string => typeof k === "string")
            : Array.isArray(raw.keywords)
              ? raw.keywords.filter((k): k is string => typeof k === "string")
              : [],
          videoId: raw.name,
        });
      }
      continue;
    }

    if (typeof raw.id !== "string" || typeof raw.name !== "string") continue;
    rows.push({
      id: raw.id,
      title: raw.name,
      description: typeof raw.description === "string" ? raw.description : "",
      categories: Array.isArray(raw.categories)
        ? raw.categories.filter((c): c is string => typeof c === "string")
        : [],
      keywords: Array.isArray(raw.keywords)
        ? raw.keywords.filter((k): k is string => typeof k === "string")
        : [],
    });
  }
  return rows;
});

const allTiles = computed(() => buildGalleryTiles(registryLite.value, introVideoById));

const categories = computed(() => collectGalleryCategories(allTiles.value));

const tiles = computed(() =>
  filterGalleryTiles(allTiles.value, query.value, activeCategory.value),
);

/** Toggle a category chip; clicking the active chip returns to All. */
function selectCategory(category: string | null) {
  if (category !== null && activeCategory.value === category) {
    activeCategory.value = null;
    return;
  }
  activeCategory.value = category;
}

/**
 * Add a widget, focus it, keep the gallery open.
 *
 * Deliberately *not* placed under the click any more: the gallery is a wide
 * panel and the tile you clicked is inside it, so the new card opened behind
 * the gallery — Add appeared to do nothing until you moved the panel away. The
 * host now places a pick on the free side of the palette; `origin` is the whole
 * request, because where that side is depends on desk geometry the gallery
 * cannot see.
 */
async function onAdd(id: string) {
  const instanceId = addWidget?.(id, { origin: "gallery" });
  if (instanceId) await focusWidget?.(instanceId);
}
</script>

<template>
  <div class="gallery-root" data-onboarding-target="widget-gallery">
    <div class="gallery-toolbar">
      <input
        v-model="query"
        type="search"
        class="gallery-search"
        placeholder="Search widgets…"
        aria-label="Search widgets"
        @keydown.stop
      />
      <div class="gallery-filters" role="tablist" aria-label="Categories">
        <button
          type="button"
          role="tab"
          class="gallery-filter"
          :class="{ 'gallery-filter--active': activeCategory === null }"
          :aria-selected="activeCategory === null"
          @click="selectCategory(null)"
        >
          All
        </button>
        <button
          v-for="cat in categories"
          :key="cat"
          type="button"
          role="tab"
          class="gallery-filter"
          :class="{ 'gallery-filter--active': activeCategory === cat }"
          :aria-selected="activeCategory === cat"
          @click="selectCategory(cat)"
        >
          {{ cat }}
        </button>
      </div>
    </div>

    <p v-if="tiles.length === 0" class="gallery-empty">No matching widgets</p>

    <div v-else class="gallery-grid">
      <article
        v-for="tile in tiles"
        :key="tile.id"
        class="gallery-tile"
        :class="{ 'gallery-tile--blank': !tile.videoUrl }"
      >
        <!-- Frame locks 4:3 via padding-top (stretch-proof); scroll the grid, not shrink tiles. -->
        <div class="gallery-tile-frame">
          <!-- `data-intro-src` instead of `src`: the directive attaches the
               source when the tile scrolls in and releases it when it leaves. -->
          <video
            v-if="tile.videoUrl"
            v-lazy-intro
            class="gallery-video"
            :data-intro-src="tile.videoUrl"
            preload="none"
            muted
            loop
            playsinline
          />
          <div class="gallery-tile-chrome">
            <div class="gallery-tile-meta">
              <span
                v-if="tile.categories.length"
                class="gallery-tile-categories"
              >{{ tile.categories.join(" · ") }}</span>
              <span class="gallery-tile-title">{{ tile.title }}</span>
              <p
                v-if="tile.description"
                class="gallery-tile-desc"
              >{{ tile.description }}</p>
            </div>
            <button
              type="button"
              class="gallery-add"
              @click.stop="onAdd(tile.id)"
            >
              Add
            </button>
          </div>
        </div>
      </article>
    </div>
  </div>
</template>

<style scoped>
.gallery-root {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  height: 100%;
  min-width: 0;
  /* Shrink with the host card so the grid (not the tiles) absorbs overflow. */
  min-height: 0;
  overflow: hidden;
  /* Host card already pads 14×16 — no extra inset. */
  padding: 0;
}

.gallery-toolbar {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex-shrink: 0;
}

.gallery-search {
  box-sizing: border-box;
  width: 100%;
  height: 32px;
  padding: 0 10px;
  border-radius: 8px;
  border: 1px solid rgba(var(--fg-rgb), 0.12);
  background: rgba(var(--fg-rgb), 0.06);
  color: rgba(var(--fg-rgb), 0.92);
  font-size: 13px;
  outline: none;
}

.gallery-search::placeholder {
  color: rgba(var(--fg-rgb), 0.4);
}

.gallery-search:focus {
  border-color: rgba(var(--fg-rgb), 0.28);
  background: rgba(var(--fg-rgb), 0.08);
}

.gallery-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.gallery-filter {
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid rgba(var(--fg-rgb), 0.12);
  background: transparent;
  color: rgba(var(--fg-rgb), 0.55);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: capitalize;
  cursor: pointer;
  transition:
    background 120ms ease,
    border-color 120ms ease,
    color 120ms ease;
}

.gallery-filter:hover {
  border-color: rgba(var(--fg-rgb), 0.22);
  color: rgba(var(--fg-rgb), 0.85);
}

.gallery-filter--active {
  border-color: rgba(var(--fg-rgb), 0.28);
  background: rgba(var(--fg-rgb), 0.12);
  color: rgba(var(--fg-rgb), 0.95);
}

.gallery-empty {
  margin: 0;
  padding: 24px 8px;
  text-align: center;
  font-size: 12px;
  color: rgba(var(--fg-rgb), 0.45);
}

.gallery-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  grid-auto-rows: max-content;
  gap: 10px;
  width: 100%;
  /* Fill remaining card height; scroll when tile rows exceed the viewport. */
  flex: 1 1 0;
  min-height: 0;
  align-items: start;
  align-content: start;
  overflow-x: hidden;
  overflow-y: auto;
}

/* Outer cell: do not stretch with the grid track. */
.gallery-tile {
  width: 100%;
  min-width: 0;
  align-self: start;
  transform: translateY(0);
  transition: transform 160ms ease;
}

.gallery-tile:hover {
  transform: translateY(-3px);
}

/*
 * Inner frame: classic percentage padding locks 4:3 from width alone.
 * Grid stretch / host zoom cannot collapse this the way aspect-ratio can.
 */
.gallery-tile-frame {
  position: relative;
  width: 100%;
  height: 0;
  padding-top: 75%; /* 3/4 → 4:3 */
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid rgba(var(--fg-rgb), 0.1);
  background: rgba(0, 0, 0, 0.28);
  transition:
    border-color 160ms ease,
    box-shadow 160ms ease;
}

.gallery-tile:hover .gallery-tile-frame {
  border-color: rgba(var(--fg-rgb), 0.28);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.35);
}

.gallery-tile--blank .gallery-tile-frame {
  background: rgba(var(--fg-rgb), 0.06);
}

.gallery-video {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  pointer-events: none;
}

.gallery-tile-chrome {
  position: absolute;
  inset: auto 0 0 0;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 10px;
  padding: 36px 12px 12px;
  background: linear-gradient(transparent, rgba(0, 0, 0, 0.78));
  pointer-events: none;
}

.gallery-tile-meta {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.gallery-tile-categories {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.55);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.gallery-tile-title {
  min-width: 0;
  font-size: 16px;
  font-weight: 700;
  line-height: 1.2;
  color: rgba(255, 255, 255, 0.96);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Two-line blurb slides up from below the chrome on hover. */
.gallery-tile-desc {
  margin: 0;
  max-height: 0;
  opacity: 0;
  overflow: hidden;
  transform: translateY(8px);
  font-size: 11px;
  font-weight: 500;
  line-height: 1.35;
  color: rgba(255, 255, 255, 0.72);
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  transition:
    max-height 200ms ease,
    opacity 180ms ease,
    transform 200ms ease,
    margin 200ms ease;
}

.gallery-tile:hover .gallery-tile-desc {
  max-height: 2.8em;
  margin-top: 4px;
  opacity: 1;
  transform: translateY(0);
}

.gallery-add {
  flex-shrink: 0;
  align-self: flex-end;
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.28);
  background: rgba(255, 255, 255, 0.14);
  color: rgba(255, 255, 255, 0.95);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  opacity: 0;
  pointer-events: none;
  transition:
    opacity 160ms ease,
    background 120ms ease,
    border-color 120ms ease;
}

.gallery-tile:hover .gallery-add {
  opacity: 1;
  pointer-events: auto;
}

.gallery-add:hover {
  background: rgba(255, 255, 255, 0.24);
  border-color: rgba(255, 255, 255, 0.4);
}
</style>
