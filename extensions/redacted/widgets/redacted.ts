import { defineWidget, type WidgetContext } from "@sdk/contract/sdk";

export interface RedactedConfig {
  /** Opaque fill color as #RRGGBB. */
  color: string;
  /** Corner radius applied to the cover and host card, in CSS pixels. */
  borderRadius: number;
}

export const DEFAULT_BORDER_RADIUS = 16;
export const MIN_BORDER_RADIUS = 0;
export const MAX_BORDER_RADIUS = 64;
export const DEFAULT_REDACTED_CONFIG: RedactedConfig = {
  color: "#000000",
  borderRadius: DEFAULT_BORDER_RADIUS,
};

/** Accept #RGB or #RRGGBB; otherwise fall back to black. */
export function normalizeColor(raw: unknown): string {
  if (typeof raw !== "string") return DEFAULT_REDACTED_CONFIG.color;
  const trimmed = raw.trim();
  const short = /^#([0-9a-fA-F]{3})$/.exec(trimmed);
  if (short) {
    const [r, g, b] = short[1]!.split("");
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed.toLowerCase();
  return DEFAULT_REDACTED_CONFIG.color;
}

export function clampBorderRadius(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_BORDER_RADIUS;
  return Math.min(MAX_BORDER_RADIUS, Math.max(MIN_BORDER_RADIUS, Math.round(value)));
}

/** Normalize persisted legacy config and the readonly contract config alike. */
export function normalizeRedactedConfig(raw: unknown): RedactedConfig {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    color: normalizeColor(value.color),
    borderRadius: clampBorderRadius(
      typeof value.borderRadius === "number" ? value.borderRadius : DEFAULT_BORDER_RADIUS,
    ),
  };
}

export interface RedactedModel {
  config: RedactedConfig;
}

export const redactedWidget = defineWidget<RedactedConfig>({
  name: "redacted",
  displayName: "Redacted",
  description: "Opaque cover for sensitive areas while screensharing.",
  defaultSize: { w: 2, h: 2 },
  minSize: { w: 1, h: 1 },
  mode: "both",
  configuration: {
    color: {
      type: "string",
      label: "Cover color",
      default: DEFAULT_REDACTED_CONFIG.color,
    },
    borderRadius: {
      type: "number",
      label: "Border radius (px)",
      default: DEFAULT_BORDER_RADIUS,
    },
  },
  component: {
    setup(ctx: WidgetContext<RedactedConfig>): RedactedModel {
      return { config: normalizeRedactedConfig(ctx.config) };
    },
  },
});
