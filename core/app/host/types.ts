/**
 * Shared host/instance types used by the layout system and every extension UI.
 */

import type { WidgetPosition, WidgetProps } from "@sdk/types";
import type { WidgetAppearance } from "./widgetAppearance";

// Both belong to the extension contract and live in the MIT SDK; re-exported here so
// host modules can keep importing their layout types from one place.
export type { WidgetPosition, WidgetProps };

/** One on-screen widget card (may share a registry type with other instances). */
export interface WidgetInstance {
  instanceId: string;
  typeId: string;
  offset: WidgetPosition;
  /** Custom display title; falls back to the extension name. */
  title?: string;
  /** When true, the card title row is hidden. */
  hideTitle?: boolean;
  /** This instance's own surface, over the manifest's `ui.appearance`. */
  appearance?: WidgetAppearance;
  /**
   * Persisted Hidden: not visible; background widgets may stay mounted. Can be shown again
   * from the palette. Distinct from session cockpit close (Ctrl double tap / outside click).
   */
  hidden?: boolean;
  /**
   * When this card was last soft-hidden (ms since epoch). The palette Hidden
   * list is newest-first; omitted on older layouts and while the card is open.
   */
  hiddenAt?: number;
  /**
   * Pinned: always mounted when not Hidden (survives outside click and cockpit close).
   * Default (not pinned): visible only while the cockpit session is open.
   */
  pinned?: boolean;
  /** Optional host-owned card width in CSS pixels (edge-resize). */
  width?: number;
  /** Optional host-owned card height in CSS pixels (edge-resize). */
  height?: number;
  /**
   * Body content zoom (1 = default). Updated while Ctrl+resizing;
   * normal resize leaves this unchanged.
   */
  contentScale?: number;
}

/** Persisted layout for layout-v3. */
export interface SavedLayoutV3 {
  palette: WidgetPosition;
  /** Pinned palette: stays open when the cockpit session closes. */
  palettePinned?: boolean;
  /** Command palette outer width in CSS pixels. */
  paletteWidth?: number;
  /** Command palette results list height in CSS pixels. */
  paletteListHeight?: number;
  instances: WidgetInstance[];
}

/** Per-desk widget geometry and visibility (catalog holds type/title). */
export interface DeskPlacement {
  instanceId: string;
  offset: WidgetPosition;
  width?: number;
  height?: number;
  contentScale?: number;
  hidden?: boolean;
  /** Last soft-hide time; kept only while `hidden` is true. */
  hiddenAt?: number;
  pinned?: boolean;
}

/** One named desk with its own palette chrome and widget placements. */
export interface Desk {
  id: string;
  name: string;
  palette: WidgetPosition;
  palettePinned?: boolean;
  paletteWidth?: number;
  paletteListHeight?: number;
  /**
   * Window size (CSS px) when palette/placements were last saved.
   * Used to scale the desk onto a different monitor/resolution.
   */
  viewport?: { width: number; height: number };
  placements: DeskPlacement[];
}

/** Global widget instance metadata shared across desks. */
export interface WidgetCatalogEntry {
  instanceId: string;
  typeId: string;
  title?: string;
  hideTitle?: boolean;
  appearance?: WidgetAppearance;
}

/** Persisted layout for layout-v4 (catalog + per-desk placements). */
export interface SavedLayoutV4 {
  activeDeskId: string;
  desks: Desk[];
  catalog: WidgetCatalogEntry[];
}
