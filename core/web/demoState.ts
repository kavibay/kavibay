/**
 * The desk every visitor starts from.
 *
 * Served as the `web_storage_load` snapshot, so it goes through the app's own
 * hydration (`system/durableStorage.ts`) exactly like a saved desk on the
 * desktop. Keys and shapes are the app's; nothing here is web-specific.
 *
 * The top centre stays empty: on the landing page the section's headline sits
 * there, under the app.
 *
 * Geometry is authored for the page's screen (`SCREEN`): a placement's offset
 * is the card's centre relative to the palette's centre, as `layout-v4` stores
 * it. To rearrange, run `web.html?keep`, drag, and read the placements back
 * out of `localStorage["kavibay:layout-v4"]`.
 */

export const SCREEN = { width: 1440, height: 930 } as const;

interface Card {
  id: string;
  typeId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

const CARDS: Card[] = [
  { id: "demo-todo", typeId: "todo", x: -500, y: -170, width: 285, height: 255 },
  { id: "demo-notes", typeId: "notes", x: -500, y: 150, width: 285, height: 195 },
  { id: "demo-clock", typeId: "clock", x: 480, y: -230, width: 195, height: 120 },
  { id: "demo-calculator", typeId: "calculator", x: 480, y: 90, width: 195, height: 285 },
];

function layoutOf(cards: Card[], palette = { x: SCREEN.width / 2, y: SCREEN.height / 2 }) {
  return {
    activeDeskId: "1",
    desks: [
      {
        id: "1",
        name: "Desk 1",
        palette,
        viewport: SCREEN,
        placements: cards.map((card) => ({
          instanceId: card.id,
          offset: { x: card.x, y: card.y },
          width: card.width,
          height: card.height,
        })),
      },
    ],
    catalog: cards.map((card) => ({ instanceId: card.id, typeId: card.typeId })),
  };
}

/** `ctx.data` lives under `kavibay:widget-data:<instance>\0<key>` (data-store.ts). */
const widgetData = (instanceId: string, value: unknown) => ({
  [`kavibay:widget-data:${instanceId}\u0000state`]: JSON.stringify(value),
});

const todo = (id: string, text: string, done: boolean, order: number) => ({
  id,
  text,
  done,
  parentId: null,
  order,
  collapsed: false,
});

/** Past the first run: no setup card, no tour. */
const SETTLED = {
  "kavibay:first-open-done": "1",
  "kavibay:setup-v1": JSON.stringify({ status: "done" }),
  "kavibay:onboarding-v3": JSON.stringify({ status: "completed", step: 1 }),
};

/** The launcher stage: a lived-in desk around the palette. */
const DESK: Record<string, string> = {
  ...SETTLED,
  "kavibay:layout-v4": JSON.stringify(layoutOf(CARDS)),
  ...widgetData("demo-todo", {
    items: [
      todo("t1", "Send Northwind invoice", true, 0),
      todo("t2", "Review Q4 roadmap", false, 1),
      todo("t3", "Book flights to Lisbon", false, 2),
    ],
    width: 280,
    height: 260,
  }),
  ...widgetData("demo-notes", {
    markdown:
      "**Standup**\n\n- Landing demo runs the real app\n- Wizard: water tracker next\n- Ask Sam about the tado key",
    width: 280,
    height: 190,
    toolbarVisible: false,
  }),
};

/**
 * The Wizard stage: nothing but the palette. The scripted tour (webTour.ts)
 * opens the Wizard from it, the way a person would.
 *
 * The Wizard opens centred on the palette at the size last used for its type
 * (typeSizeMemory.ts): 940×460 over a palette at y=570 puts it at 340–800,
 * below the page's headline and case buttons and above its playback bar. When
 * the tour closes it and opens the result, the new card spawns just above the
 * palette — clear of the buttons too.
 */
const WIZARD_SIZE = { w: 940, h: 460 };
const WIZARD_TOP = 340;
const WIZARD: Record<string, string> = {
  ...SETTLED,
  "kavibay:layout-v4": JSON.stringify(layoutOf([], { x: SCREEN.width / 2, y: WIZARD_TOP + WIZARD_SIZE.h / 2 })),
  "kavibay:widget-type-size-v1": JSON.stringify({ "widget-wizard": WIZARD_SIZE }),
};

export const SCENES = { desk: DESK, wizard: WIZARD } as const;
export type Scene = keyof typeof SCENES;

export function isScene(value: string | null): value is Scene {
  return value !== null && Object.prototype.hasOwnProperty.call(SCENES, value);
}

let scene: Scene = "desk";

/** Chosen once, from the page's `?scene=`, before the app boots. */
export function useScene(next: Scene): void {
  scene = next;
}

/** The saved state `web_storage_load` hands the app. */
export function demoState(): Record<string, string> {
  return SCENES[scene];
}
