import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type {
  AlarmNotification,
  ColorPickerEvent,
  ColorPickerSample,
  FocusTrackerGroupBy,
  FocusTrackerIgnoreKind,
  FocusTrackerRange,
  LlmChatRequest,
  LlmStreamEvent,
  NotificationRequest,
  NowPlayingControl,
  DraftChanged,
  DraftPresence,
  WidgetExportReport,
  WidgetInstanceId,
} from "@sdk/contract/sdk";
import { playSessionEndBeep } from "../audio/sessionEndBeep";
import { keyPlatform } from "../host/shortcutHints";
import { withRealPathSeparators } from "../runtime/manifestValidate";
import type { WidgetCapabilityTransport } from "./widgetCapabilityTransport";

/**
 * Native dialogs cover the fullscreen transparent window, so their buttons
 * must not be mistaken for an outside click on the desktop underneath.
 * Keeping this in the host transport lets extensions stay within the SDK
 * boundary while still restoring the normal hit-test behavior afterwards.
 */
async function withClickThroughPaused<T>(operation: () => Promise<T>): Promise<T> {
  let paused = false;
  try {
    await invoke("set_click_through_paused", { paused: true });
    paused = true;
  } catch {
    // The dialog remains usable in non-Tauri/dev harnesses.
  }

  try {
    return await operation();
  } finally {
    if (paused) {
      await invoke("set_click_through_paused", { paused: false }).catch(() => {
        // Do not replace a dialog/import error with a cleanup error.
      });
    }
  }
}

/**
 * The app-side implementation of the reviewed widget capabilities.
 *
 * No command name comes from a widget. The host maps the small SDK action
 * vocabulary to the registered Rust commands here.
 */
export const tauriWidgetCapabilityTransport: WidgetCapabilityTransport = {
  aiUsageSnapshot: () => invoke("widget_ai_usage"),
  aiUsageEnableClaudeCapture: () => invoke("widget_ai_usage_enable_claude"),
  notificationShow: (request: NotificationRequest) =>
    invoke("widget_notification_show", { title: request.title, body: request.body }),
  systemInfoSnapshot: () => invoke("widget_system_info"),
  nowPlayingSnapshot: () => invoke("widget_now_playing"),
  nowPlayingControl: (action: NowPlayingControl) => {
    // The macOS consent dialog floats above the cockpit, so its buttons are
    // held like every other native dialog here.
    if (action === "connect") {
      return withClickThroughPaused(() => invoke("now_playing_connect"));
    }
    const command = {
      previous: "now_playing_prev",
      playPause: "now_playing_play_pause",
      next: "now_playing_next",
      openSource: "now_playing_open_source",
    }[action];
    return invoke(command);
  },
  alarmNotify: async (instanceId: WidgetInstanceId, mode: AlarmNotification) => {
    if (mode === "sound" || mode === "sound_and_pop") {
      playSessionEndBeep();
    }
    if (mode !== "pop" && mode !== "sound_and_pop") return;

    try {
      const win = getCurrentWindow();
      await win.show();
      await win.setFocus();
      window.dispatchEvent(
        new CustomEvent("kavibay:reveal-widget", { detail: { instanceId } }),
      );
    } catch {
      // The alarm still rings when window focus is unavailable.
    }
  },
  openExternalVouched: (url: string) => invoke<void>("extension_open_external", { url }),

  openExternal: async (url: string) => {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") {
      throw new Error("only HTTPS URLs may be opened by a widget");
    }
    await invoke("launch_path", { path: parsed.toString() });
  },
  clipboardWriteText: async (text: string) => {
    if (!navigator.clipboard?.writeText) {
      throw new Error("clipboard is unavailable");
    }
    await navigator.clipboard.writeText(text);
  },
  clipboardList: () => invoke("clipboard_list"),
  clipboardOnChange: (listener) =>
    listen<unknown>("clipboard:updated", (event) => listener(event.payload)),
  clipboardRestore: (id: string) => invoke("clipboard_restore", { id }),
  clipboardSetRevealed: (id: string, revealed: boolean) =>
    invoke("clipboard_set_revealed", { id, revealed }),
  clipboardDelete: (id: string) => invoke("clipboard_delete", { id }),
  clipboardClear: () => invoke("clipboard_clear"),
  clipboardImageUrl: (path: string) => convertFileSrc(path),
  colorPickerStart: async (onEvent: (event: ColorPickerEvent) => void) => {
    const unlisten = await Promise.all([
      listen<ColorPickerSample>("color-picker:sample", (event) =>
        onEvent({ type: "sample", sample: event.payload }),
      ),
      listen<ColorPickerSample>("color-picker:picked", (event) =>
        onEvent({ type: "picked", sample: event.payload }),
      ),
      listen("color-picker:cancelled", () => onEvent({ type: "cancelled" })),
    ]);
    try {
      await invoke("color_picker_start");
    } catch (error) {
      unlisten.forEach((off) => off());
      throw error;
    }
    return () => unlisten.forEach((off) => off());
  },
  colorPickerStop: () => invoke("color_picker_stop"),
  imagePick: async () => {
    const selected = await withClickThroughPaused(() => open({
      multiple: false,
      directory: false,
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp"] }],
    }));
    return Array.isArray(selected) ? selected[0] ?? null : selected;
  },
  imageImport: (instanceId: WidgetInstanceId, sourcePath: string) =>
    invoke("image_widget_import", { instanceId, sourcePath }),
  imageClear: (instanceId: WidgetInstanceId) => invoke("image_widget_clear", { instanceId }),
  imageUrl: (path: string) => convertFileSrc(path),
  launcherPick: async (kind: "file" | "folder" | "image") => {
    const selected = await withClickThroughPaused(() => open(
      kind === "folder"
        ? { multiple: true, directory: true }
        : kind === "image"
          ? {
              multiple: true,
              directory: false,
              filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp"] }],
            }
          : {
              multiple: true,
              directory: false,
              filters: [
                {
                  name: "Apps",
                  // A Mac app is an .app bundle, which the picker offers as one file.
                  extensions: keyPlatform() === "mac" ? ["app"] : ["exe", "lnk"],
                },
              ],
            },
    ));
    if (selected == null) return [];
    return Array.isArray(selected) ? selected : [selected];
  },
  launcherListInstalled: () => invoke("list_installed_apps"),
  launcherExtractIcon: (path: string) => invoke("extract_app_icon", { path }),
  launcherLoadIcon: (path: string) => invoke("load_local_icon", { path }),
  launcherFetchUrlIcon: (url: string) => invoke("fetch_url_icon", { url }),
  launcherLaunch: (path: string) => invoke("launch_path", { path }),
  launcherSendKey: (keyId: string) => invoke("send_virtual_key", { keyId }),
  focusTrackerStatus: () => invoke("focus_tracker_status"),
  focusTrackerSummary: (range: FocusTrackerRange, groupBy: FocusTrackerGroupBy) =>
    invoke("focus_tracker_summary", { range, groupBy }),
  focusTrackerListHabitRules: () => invoke("focus_tracker_list_habit_rules"),
  focusTrackerUpsertHabitRule: (appName: string, limitMinutes: number) =>
    invoke("focus_tracker_upsert_habit_rule", { appName, limitMinutes }),
  focusTrackerDeleteHabitRule: (id: number) =>
    invoke("focus_tracker_delete_habit_rule", { id }),
  focusTrackerRecentApps: (limit?: number) =>
    invoke("focus_tracker_recent_apps", limit === undefined ? undefined : { limit }),
  focusTrackerListIgnoreRules: () => invoke("focus_tracker_list_ignore_rules"),
  focusTrackerUpsertIgnoreRule: (kind: FocusTrackerIgnoreKind, value: string) =>
    invoke("focus_tracker_upsert_ignore_rule", { kind, value }),
  focusTrackerDeleteIgnoreRule: (id: number) =>
    invoke("focus_tracker_delete_ignore_rule", { id }),
  llmModels: (instanceId) => invoke("llm_models", { instanceId }),
  llmQuickModel: () => invoke("llm_quick_model"),
  llmStream: async (
    instanceId: WidgetInstanceId,
    request: LlmChatRequest,
    onEvent: (event: LlmStreamEvent) => void,
    owner?: string,
  ) => {
    let unlisteners: Array<() => void> = [];
    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      unlisteners.forEach((unlisten) => unlisten());
      unlisteners = [];
    };
    const matches = (payload: { instanceId?: string; requestId?: string }) =>
      payload.instanceId === instanceId && payload.requestId === request.requestId;

    try {
      const listeners = await Promise.all([
        listen<{ instanceId: string; requestId: string; text: string }>("llm:chunk", (event) => {
          if (matches(event.payload)) onEvent({ type: "chunk", text: event.payload.text });
        }),
        listen<{ instanceId: string; requestId: string }>("llm:done", (event) => {
          if (!matches(event.payload)) return;
          onEvent({ type: "done" });
          stop();
        }),
        listen<{ instanceId: string; requestId: string }>("llm:cancelled", (event) => {
          if (!matches(event.payload)) return;
          onEvent({ type: "cancelled" });
          stop();
        }),
        listen<{ instanceId: string; requestId: string; message: string }>("llm:error", (event) => {
          if (!matches(event.payload)) return;
          onEvent({ type: "error", message: event.payload.message });
          stop();
        }),
      ]);
      unlisteners = listeners;
      await invoke("llm_chat_stream", {
        instanceId,
        owner: owner ?? `widget:${instanceId}`,
        requestId: request.requestId,
        model: request.model,
        messages: request.messages,
      });
    } catch (error) {
      stop();
      throw error;
    }
  },
  llmCancel: (requestId: string) => invoke("llm_chat_cancel", { requestId }),
  wizardModels: (instanceId) => invoke("wizard_models", { instanceId }),
  wizardComplete: (request, instanceId) => invoke("wizard_complete", { ...request, instanceId }),
  wizardConversationsList: () => invoke("wizard_conversations_list"),
  wizardConversationLoad: (id: string) => invoke("wizard_conversation_load", { id }),
  wizardConversationSave: (conversation: unknown) =>
    invoke("wizard_conversation_save", { conversation }),
  wizardConversationDelete: (id: string) => invoke("wizard_conversation_delete", { id }),
  runtimeHttpCall: (extId: string, endpointId: string, args: Record<string, unknown>, instanceId: string) =>
    invoke("runtime_extensions_http_call", { extId, endpointId, args, instanceId }),
  wizardRuntimeScan: () => invoke("runtime_extensions_scan"),
  wizardRuntimeInstalls: () => invoke("runtime_extensions_installs_list"),
  wizardRuntimeEntryUrl: (id: string, entry: string) =>
    withRealPathSeparators(convertFileSrc(`${id}/${entry}`, "kavibay-ext")),
  wizardRuntimeSetEnabled: (
    id: string,
    enabled: boolean,
    manifestPermissions: string[],
    contractGrant?: unknown,
  ) =>
    invoke("runtime_extensions_installs_set", {
      id,
      enabled,
      manifestPermissions,
      contractGrant: contractGrant ?? null,
    }).then(() => undefined),
  wizardRuntimeReadPackage: (id: string) => invoke("runtime_extensions_read_package", { id }),
  wizardRuntimeDeletePackage: (id: string) =>
    invoke("runtime_extensions_delete_package", { id }).then(() => undefined),
  /**
   * Pick a destination, then have Rust write the archive to it.
   *
   * Two steps rather than one because only this side can raise a native dialog
   * and only Rust can read the package folder — and the two must not be
   * collapsed by letting the widget supply either half. The dialog runs behind
   * `withClickThroughPaused` for the same reason every other one here does:
   * over a transparent fullscreen window, a click on its buttons is otherwise
   * an outside click on the desktop underneath, which hides the app mid-save.
   */
  wizardExportPackage: async (id: string) => {
    const target = await withClickThroughPaused(() =>
      save({
        title: "Export widget",
        defaultPath: `${id}.zip`,
        filters: [{ name: "Zip archive", extensions: ["zip"] }],
      }),
    );
    if (!target) return null;
    return invoke<WidgetExportReport>("runtime_extensions_export_package", { id, target });
  },
  // The same command RuntimeExtensionFrame calls, with the same ext id.
  wizardEndpointCall: (extId: string, endpointId: string, args: unknown) =>
    invoke("runtime_extensions_http_call", { extId, endpointId, args: args ?? null, instanceId: `preview:${extId}` }),
  wizardDrafts: () => invoke("runtime_extensions_draft_list"),
  wizardDraftRead: (id: string) => invoke("runtime_extensions_draft_read", { id }),
  wizardDraftOpen: (id: string) => invoke("runtime_extensions_draft_open", { id }),
  wizardOnDraftChanged: (handler: (event: DraftChanged) => void) =>
    listen<DraftChanged>("runtime-draft:changed", (event) => handler(event.payload)),
  wizardDraftPresence: () => invoke("mcp_draft_presence"),
  wizardOnDraftPresenceChanged: (handler: (event: DraftPresence) => void) =>
    listen<DraftPresence>("runtime-draft:presence", (event) => handler(event.payload)),
  wizardDraftWrite: (id: string, files: unknown, expectedRevision?: string | null) =>
    invoke("runtime_extensions_draft_write", {
      id,
      files,
      expectedRevision: expectedRevision ?? null,
    }),
  wizardDraftPromote: (id: string, replaces?: string | null) =>
    invoke("runtime_extensions_draft_promote", { id, replaces: replaces ?? null }),
  wizardDraftDiscard: (id: string) =>
    invoke("runtime_extensions_draft_discard", { id }).then(() => undefined),
};
