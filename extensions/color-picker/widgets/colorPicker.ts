// SPDX-License-Identifier: MIT
import { computed, onScopeDispose, ref, type ComputedRef, type Ref } from "vue";
import {
  defineWidget,
  type ColorPickerEvent,
  type ColorPickerSample,
  type WidgetContext,
} from "@sdk/contract/sdk";
import {
  DEFAULT_RGB,
  formatHslCss,
  formatRgbCss,
  rgbToHex,
  rgbToHsl,
  type Rgb,
} from "../colorPickerLogic";
import { colorPickerPicking } from "../colorPickerSession";

export interface ColorPickerModel {
  fixed: Ref<Rgb>;
  live: Ref<Rgb | null>;
  picking: Ref<boolean>;
  pickError: Ref<string | null>;
  copiedKey: Ref<"hex" | "rgb" | "hsl" | null>;
  display: ComputedRef<Rgb>;
  hex: ComputedRef<string>;
  rgbCss: ComputedRef<string>;
  hslCss: ComputedRef<string>;
  swatchStyle: ComputedRef<{ background: string }>;
  copyValue(key: "hex" | "rgb" | "hsl", value: string): Promise<void>;
  startPick(): Promise<void>;
  cancelPick(): Promise<void>;
}

export const colorPickerWidget = defineWidget({
  name: "color-picker",
  displayName: "Color Picker",
  description: "Pick and copy screen colors.",
  defaultSize: { w: 200, h: 160 },
  minSize: { w: 160, h: 130 },
  mode: "both",
  capabilities: { colorPicker: true, clipboard: true },
  component: {
    setup(ctx: WidgetContext): ColorPickerModel {
      const fixed = ref<Rgb>({ ...DEFAULT_RGB });
      const live = ref<Rgb | null>(null);
      const picking = ref(false);
      const pickError = ref<string | null>(null);
      const copiedKey = ref<"hex" | "rgb" | "hsl" | null>(null);
      let copiedTimer: ReturnType<typeof setTimeout> | undefined;
      let unlisten: (() => void) | undefined;
      let session = 0;

      const display = computed(() => live.value ?? fixed.value);
      const hex = computed(() => rgbToHex(display.value));
      const rgbCss = computed(() => formatRgbCss(display.value));
      const hslCss = computed(() => formatHslCss(rgbToHsl(display.value)));
      const swatchStyle = computed(() => ({ background: hex.value }));

      const setPicking = (active: boolean) => {
        picking.value = active;
        colorPickerPicking.value = active;
      };

      const stopListening = () => {
        unlisten?.();
        unlisten = undefined;
      };

      const onEvent = (event: ColorPickerEvent) => {
        if (event.type === "sample") {
          live.value = { ...event.sample };
          return;
        }
        if (event.type === "picked") fixed.value = { ...event.sample };
        live.value = null;
        setPicking(false);
        stopListening();
      };

      const copyValue = async (key: "hex" | "rgb" | "hsl", value: string) => {
        try {
          await ctx.clipboard!.writeText(value);
          copiedKey.value = key;
          if (copiedTimer) clearTimeout(copiedTimer);
          copiedTimer = setTimeout(() => { copiedKey.value = null; }, 1_000);
        } catch {
          // Clipboard failures are non-fatal; the color remains available to copy again.
        }
      };

      const startPick = async () => {
        if (!ctx.colorPicker) {
          pickError.value = "Pick unavailable";
          return;
        }
        const current = ++session;
        pickError.value = null;
        stopListening();
        setPicking(true);
        live.value = { ...fixed.value };
        try {
          const dispose = await ctx.colorPicker.start(onEvent);
          if (current !== session) dispose();
          else unlisten = dispose;
        } catch {
          setPicking(false);
          live.value = null;
          pickError.value = "Pick unavailable";
          stopListening();
        }
      };

      const cancelPick = async () => {
        if (!picking.value) return;
        session++;
        try {
          await ctx.colorPicker?.stop();
        } catch {
          // The native session may already have ended.
        }
        live.value = null;
        setPicking(false);
        stopListening();
      };

      onScopeDispose(() => {
        session++;
        stopListening();
        if (picking.value) void ctx.colorPicker?.stop();
        colorPickerPicking.value = false;
        if (copiedTimer) clearTimeout(copiedTimer);
      });

      return {
        fixed, live, picking, pickError, copiedKey, display, hex, rgbCss, hslCss, swatchStyle,
        copyValue, startPick, cancelPick,
      };
    },
  },
});

export type { ColorPickerSample };
