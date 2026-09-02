// SPDX-License-Identifier: MIT
import { computed, ref, watch, type Ref } from "vue";
import { defineWidget, type WidgetContext } from "@sdk/contract/sdk";
import {
  addApps,
  clampSize,
  ICON_SIZE_PX,
  normalizeIconSize,
  normalizeState,
  patchApp,
  removeApp,
  reorderApps,
  setMuted,
  type AppLauncherState,
  type LauncherApp,
  type LauncherIconSize,
} from "../appLauncherLogic";

export interface LauncherModel {
  apps: Ref<LauncherApp[]>;
  width: Ref<number>;
  height: Ref<number>;
  hideAddButton: Ref<boolean>;
  iconSize: Ref<LauncherIconSize>;
  openAddSignal: Ref<number>;
  error: Ref<string | null>;
  setError(message: string | null): void;
  addEntries(entries: LauncherApp[]): void;
  remove(id: string): void;
  reorder(fromIndex: number, toIndex: number): void;
  mute(id: string): void;
  clearMute(id: string): void;
  updateApp(id: string, patch: Partial<Omit<LauncherApp, "id">>): void;
  setSize(width: number, height: number): void;
  setHideAddButton(hide: boolean): void;
  requestOpenAddMenu(): void;
  pick(kind: "file" | "folder" | "image"): Promise<string[]>;
  listInstalled<T = unknown>(): Promise<T>;
  extractIcon(path: string): Promise<string>;
  loadIcon(path: string): Promise<string>;
  fetchUrlIcon(url: string): Promise<string>;
  launch(path: string): Promise<void>;
  sendKey(keyId: string): Promise<void>;
}

interface LauncherConfig {
  hideAddButton?: boolean;
  iconSize?: LauncherIconSize;
}

const DATA_KEY = "launcher";

export const launcherButtonsWidget = defineWidget<LauncherConfig>({
  name: "launcher-buttons",
  displayName: "Launcher Buttons",
  description: "Launch pinned apps with keyboard shortcuts.",
  defaultSize: { w: 222, h: 120 },
  minSize: { w: 120, h: 72 },
  mode: "both",
  capabilities: { launcher: true },
  configuration: {
    iconSize: {
      type: "select",
      label: "Icon size",
      default: "m",
      options: [
        { value: "s", label: "Small" },
        { value: "m", label: "Medium" },
        { value: "l", label: "Large" },
        { value: "xl", label: "Extra large" },
        { value: "xxl", label: "Huge" },
      ],
    },
    hideAddButton: { type: "boolean", label: "Hide add button", default: false },
  },
  duplicateData: true,
  component: {
    setup(ctx: WidgetContext<LauncherConfig>): LauncherModel {
      const configured = normalizeState({
        iconSize: normalizeIconSize(ctx.config.iconSize),
        hideAddButton: ctx.config.hideAddButton === true,
      });
      const state = ref<AppLauncherState>(configured);
      const error = ref<string | null>(null);
      const openAddSignal = ref(0);
      let hydrated = false;

      void ctx.data.get<unknown>(DATA_KEY).then((raw) => {
        const loaded = normalizeState(raw);
        state.value = normalizeState({
          ...loaded,
          iconSize: normalizeIconSize(ctx.config.iconSize ?? loaded.iconSize),
          hideAddButton: ctx.config.hideAddButton === true || loaded.hideAddButton === true,
        });
        hydrated = true;
        void ctx.data.set(DATA_KEY, state.value);
      }).catch(() => {
        hydrated = true;
      });

      watch(state, (value) => {
        if (hydrated) void ctx.data.set(DATA_KEY, normalizeState(value));
      }, { deep: true });

      const apps = computed({
        get: () => state.value.apps,
        set: (value: LauncherApp[]) => { state.value = normalizeState({ ...state.value, apps: value }); },
      });
      const width = computed({
        get: () => state.value.width,
        set: (value: number) => { state.value = normalizeState({ ...state.value, width: value }); },
      });
      const height = computed({
        get: () => state.value.height,
        set: (value: number) => { state.value = normalizeState({ ...state.value, height: value }); },
      });
      const hideAddButton = computed({
        get: () => state.value.hideAddButton === true,
        set: (value: boolean) => { state.value = normalizeState({ ...state.value, hideAddButton: value }); },
      });
      const iconSize = computed({
        get: () => normalizeIconSize(state.value.iconSize),
        set: (value: LauncherIconSize) => { state.value = normalizeState({ ...state.value, iconSize: value }); },
      });
      const setError = (message: string | null) => { error.value = message; };
      const addEntries = (entries: LauncherApp[]) => { apps.value = addApps(apps.value, entries); };
      const remove = (id: string) => { apps.value = removeApp(apps.value, id); };
      const reorder = (fromIndex: number, toIndex: number) => { apps.value = reorderApps(apps.value, fromIndex, toIndex); };
      const mute = (id: string) => { apps.value = setMuted(apps.value, id, true); };
      const clearMute = (id: string) => { apps.value = setMuted(apps.value, id, false); };
      const updateApp = (id: string, patch: Partial<Omit<LauncherApp, "id">>) => {
        apps.value = patchApp(apps.value, id, patch);
      };
      const setSize = (nextWidth: number, nextHeight: number) => {
        const size = clampSize(nextWidth, nextHeight, ICON_SIZE_PX[iconSize.value]);
        width.value = size.width;
        height.value = size.height;
      };
      const setHideAddButton = (hide: boolean) => { hideAddButton.value = hide; };
      const requestOpenAddMenu = () => { openAddSignal.value += 1; };

      return {
        apps, width, height, hideAddButton, iconSize, openAddSignal, error,
        setError, addEntries, remove, reorder, mute, clearMute, updateApp,
        setSize, setHideAddButton, requestOpenAddMenu,
        pick: (kind) => ctx.launcher!.pick(kind),
        listInstalled: <T>() => ctx.launcher!.listInstalled<T>(),
        extractIcon: (path) => ctx.launcher!.extractIcon(path),
        loadIcon: (path) => ctx.launcher!.loadIcon(path),
        fetchUrlIcon: (url) => ctx.launcher!.fetchUrlIcon(url),
        launch: (path) => ctx.launcher!.launch(path),
        sendKey: (keyId) => ctx.launcher!.sendKey(keyId),
      };
    },
  },
});
