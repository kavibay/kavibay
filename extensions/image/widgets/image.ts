// SPDX-License-Identifier: MIT
import { ref, watch, type Ref } from "vue";
import { defineWidget, type WidgetContext } from "@sdk/contract/sdk";
import {
  normalizeState,
  type ImageVariant,
  type ImageWidgetState,
} from "../imageLogic";

export interface ImageModel {
  state: Ref<ImageWidgetState>;
  error: Ref<string | null>;
  setError(message: string | null): void;
  setFile(path: string): void;
  setUrl(url: string): void;
  setVariant(variant: ImageVariant): void;
  clear(): void;
  importPath(sourcePath: string): Promise<string>;
  pick(): Promise<string | null>;
  clearFile(): Promise<void>;
  imageUrl(path: string): string;
}

interface ImageConfig {
  variant?: ImageVariant;
}

const DATA_KEY = "image";

export const imageWidget = defineWidget<ImageConfig>({
  name: "image",
  displayName: "Image",
  description: "Show a local image or URL on the desktop.",
  defaultSize: { w: 220, h: 140 },
  minSize: { w: 120, h: 80 },
  mode: "both",
  capabilities: { image: true },
  configuration: {
    variant: {
      type: "select",
      label: "Style",
      default: "full",
      options: [
        { value: "full", label: "Full-size" },
        { value: "framed", label: "Framed" },
      ],
    },
  },
  duplicateData: true,
  component: {
    setup(ctx: WidgetContext<ImageConfig>): ImageModel {
      const configuredVariant: ImageVariant = ctx.config.variant === "framed" ? "framed" : "full";
      const state = ref<ImageWidgetState>(normalizeState({ variant: configuredVariant }));
      const error = ref<string | null>(null);
      let hydrated = false;

      void ctx.data.get<unknown>(DATA_KEY).then((raw) => {
        const loaded = normalizeState(raw);
        state.value = { ...loaded, variant: configuredVariant };
        hydrated = true;
        void ctx.data.set(DATA_KEY, state.value);
      }).catch(() => {
        hydrated = true;
      });

      watch(state, (value) => {
        if (hydrated) void ctx.data.set(DATA_KEY, normalizeState(value));
      }, { deep: true });

      const setError = (message: string | null) => { error.value = message; };
      const setFile = (path: string) => {
        state.value = normalizeState({ ...state.value, source: "file", path, url: undefined });
        error.value = null;
      };
      const setUrl = (url: string) => {
        state.value = normalizeState({ ...state.value, source: "url", url, path: undefined });
        error.value = null;
      };
      const setVariant = (variant: ImageVariant) => {
        state.value = { ...state.value, variant };
      };
      const clear = () => {
        state.value = {
          source: null,
          width: state.value.width,
          height: state.value.height,
          variant: configuredVariant,
        };
        error.value = null;
      };
      const importPath = async (sourcePath: string) => ctx.image!.import(sourcePath);
      const pick = () => ctx.image!.pick();
      const clearFile = () => ctx.image!.clear();
      const imageUrl = (path: string) => ctx.image!.imageUrl(path);

      return {
        state, error, setError, setFile, setUrl, setVariant, clear,
        importPath, pick, clearFile, imageUrl,
      };
    },
  },
});
