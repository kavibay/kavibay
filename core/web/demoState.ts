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

/** Narrower than the app's default (640): on the page the palette shares the screen with the headline and the stage. */
const PALETTE_WIDTH = 520;

interface Card {
  id: string;
  typeId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Put away: on no desk, but the app reveals it instead of making another. */
  hidden?: boolean;
  hideTitle?: boolean;
}

const CARDS: Card[] = [
  { id: "demo-todo", typeId: "todo", x: -500, y: -170, width: 285, height: 255 },
  { id: "demo-notes", typeId: "notes", x: -500, y: 150, width: 285, height: 195 },
  { id: "demo-clock", typeId: "clock", x: 480, y: -230, width: 225, height: 140 },
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
        paletteWidth: PALETTE_WIDTH,
        viewport: SCREEN,
        placements: cards.map((card) => ({
          instanceId: card.id,
          offset: { x: card.x, y: card.y },
          width: card.width,
          height: card.height,
          ...(card.hidden ? { hidden: true } : {}),
        })),
      },
    ],
    catalog: cards.map((card) => ({
      instanceId: card.id,
      typeId: card.typeId,
      ...(card.hideTitle ? { hideTitle: true } : {}),
    })),
  };
}

/** `ctx.data` lives under `kavibay:widget-data:<instance>\0<key>` (data-store.ts). */
const widgetData = (instanceId: string, value: unknown, key = "state") => ({
  [`kavibay:widget-data:${instanceId}\u0000${key}`]: JSON.stringify(value),
});

const todo = (id: string, text: string, done: boolean, order: number) => ({
  id,
  text,
  done,
  parentId: null,
  order,
  collapsed: false,
});

/**
 * Past the first run: no setup card, no tour. And no widget shortcuts in the
 * palette's bar — the default one is the clipboard history, which a browser
 * cannot read (an explicit empty list stays empty; paletteWidgetPrefsLogic.ts).
 */
const SETTLED = {
  "kavibay:first-open-done": "1",
  "kavibay:setup-v1": JSON.stringify({ status: "done" }),
  "kavibay:onboarding-v3": JSON.stringify({ status: "completed", step: 1 }),
  "kavibay:palette-widgets-v1": JSON.stringify([]),
};

/** What the todo and notes cards say, on every desk that has them. */
const DESK_DATA: Record<string, string> = {
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

/** The launcher stage: a lived-in desk around the palette. */
const DESK: Record<string, string> = {
  ...SETTLED,
  "kavibay:layout-v4": JSON.stringify(layoutOf(CARDS)),
  ...DESK_DATA,
};

/**
 * /playground: the whole window to try things in, so a few more cards — a
 * focus timer and the weather (webProviders.ts answers its forecast) — and the
 * clock above the palette instead of the calculator.
 */
const PLAYGROUND_CARDS: Card[] = [
  { id: "demo-todo", typeId: "todo", x: -520, y: -220, width: 285, height: 255 },
  { id: "demo-notes", typeId: "notes", x: -520, y: 110, width: 285, height: 195 },
  { id: "demo-clock", typeId: "clock", x: 0, y: -300, width: 225, height: 140 },
  { id: "demo-weather", typeId: "weather", x: 520, y: -230, width: 300, height: 270 },
  { id: "demo-pomodoro", typeId: "pomodoro", x: 520, y: 160, width: 300, height: 440 },
];

const PLAYGROUND: Record<string, string> = {
  ...SETTLED,
  "kavibay:layout-v4": JSON.stringify(layoutOf(PLAYGROUND_CARDS)),
  ...DESK_DATA,
  // Widget config, not ctx.data: the cockpit keeps it (cockpit.ts).
  "kavibay:widget-config:demo-weather": JSON.stringify({ location: "Lisbon" }),
};

/**
 * The Wizard stage: nothing but the palette. The scripted tour (webTour.ts)
 * opens the Wizard from it, the way a person would.
 *
 * The Wizard is already there, put away: "New Widget" reveals a hidden Wizard
 * rather than making another (WidgetHost `onAddType`), so this card is the one
 * that opens — without its title row, and with chat and preview split
 * 50:50 through the Wizard's own saved layout. It sits at 270–830, below the
 * page's headline and case buttons and above its playback bar. The palette
 * starts at y=545, where it reads as the start; when the tour closes the Wizard
 * and opens the result, the new card spawns just above the palette — clear of
 * the buttons too.
 */
const WIZARD_SIZE = { w: 990, h: 560 };
const WIZARD_TOP = 270;
const WIZARD_PREVIEW = 456;
const PALETTE_Y = 545;
const WIZARD_CARD: Card = {
  id: "demo-wizard",
  typeId: "widget-wizard",
  x: 0,
  // Placements are centre offsets from the palette.
  y: WIZARD_TOP + WIZARD_SIZE.h / 2 - PALETTE_Y,
  width: WIZARD_SIZE.w,
  height: WIZARD_SIZE.h,
  hidden: true,
  hideTitle: true,
};
const WIZARD: Record<string, string> = {
  ...SETTLED,
  "kavibay:layout-v4": JSON.stringify(
    layoutOf([WIZARD_CARD], { x: SCREEN.width / 2, y: PALETTE_Y }),
  ),
  ...widgetData(WIZARD_CARD.id, { preview: WIZARD_PREVIEW, collapsed: true }, "wizard:layout"),
};

export const SCENES = { desk: DESK, wizard: WIZARD, playground: PLAYGROUND } as const;
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
