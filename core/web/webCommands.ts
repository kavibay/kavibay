import { DEMO_HOME, listDemoFolder, searchDemoFolder } from "../embed/palette/demoFiles";
import { demoState } from "./demoState";
import { WINDOW_ANSWERS } from "./webWindow";
import { PROVIDER_ANSWERS } from "./webProviders";
import { WIZARD_ANSWERS } from "./webWizard";

/**
 * The Rust commands, answered in the browser.
 *
 * Every command the app invokes is in exactly one table — enforced by
 * `webCommands.assert.ts`, so a command the app gains fails the assert run
 * instead of failing quietly on the page:
 *
 *   ANSWERS     the page has something truthful to say — the demo desk, the
 *               invented disk, "no autostart on the web".
 *   NO_OPS      the desktop side effect has no meaning here (click-through
 *               rects, monitor choice, saving to AppData). Answered with null.
 *   NOT_ON_WEB  a feature the page does not offer (yet): credentials, screen
 *               recording, the model APIs. Rejected with `DesktopOnly`, so the
 *               app's own error handling shows a sentence a visitor can read
 *               (styled as a note by web.css) instead of a command name.
 */

type Args = Record<string, unknown>;

const DIRS: Record<number, string> = {
  1: `${DEMO_HOME}\\Music`,
  6: `${DEMO_HOME}\\Documents`,
  7: `${DEMO_HOME}\\Downloads`,
  8: `${DEMO_HOME}\\Pictures`,
  10: `${DEMO_HOME}\\Videos`,
  13: `${DEMO_HOME}\\AppData\\Roaming\\com.kavibay.app`,
  14: `${DEMO_HOME}\\AppData\\Roaming\\com.kavibay.app`,
  15: `${DEMO_HOME}\\AppData\\Local\\com.kavibay.app`,
  18: `${DEMO_HOME}\\Desktop`,
  21: DEMO_HOME,
};

/** Named like the executables a Windows desk would have; no icons, no logos. */
const INSTALLED_APPS = [
  "Google Chrome",
  "Visual Studio Code",
  "Spotify",
  "Slack",
  "Figma",
  "Notion",
  "Windows Terminal",
  "File Explorer",
  "Outlook",
].map((name) => ({ name, path: `C:\\Program Files\\${name}\\${name}.exe` }));

const limit = (args: Args, fallback: number) =>
  typeof args.limit === "number" ? args.limit : fallback;

export const ANSWERS: Record<string, (args: Args) => unknown> = {
  // The whole demo desk travels as one snapshot; `restore` takes any
  // `kavibay:` key from it, settings included.
  web_storage_load: () => JSON.stringify(demoState()),
  settings_load: () => null,
  onboarding_preferences_load: () => null,

  autostart_supported: () => false,
  autostart_enabled: () => false,
  demo_mode_enabled: () => false,
  // No native gap click on a page: the DOM catcher is the only way to dismiss.
  needs_dom_gap_catcher: () => true,
  cockpit_reveal_gesture: () => null,
  "plugin:path|resolve_directory": (args) => DIRS[Number(args.directory)] ?? DEMO_HOME,

  llm_catalog: () => [],
  llm_quick_model: () => ({ selected: "", resolved: "" }),

  list_installed_apps: () => INSTALLED_APPS,
  extract_app_icon: () => "",
  // No shell icons in a browser: every row keeps its drawn mark.
  get_cached_app_icons: () => ({}),
  get_file_type_icons: () => ({}),
  browse_folder: (args) => listDemoFolder(String(args.dir)).slice(0, limit(args, 100)),
  search_folder: (args) =>
    searchDemoFolder(String(args.dir), String(args.query ?? ""), limit(args, 40)),
  list_path_completions: (args) => {
    const prefix = String(args.prefix ?? "").toLowerCase();
    return listDemoFolder(String(args.dir))
      .filter((entry) => entry.name.toLowerCase().startsWith(prefix))
      .slice(0, limit(args, 50));
  },

  runtime_extensions_installs_import: () => null,

  // Opening a link is what a browser is for.
  extension_open_external: (args) => {
    window.open(String(args.url), "_blank", "noopener,noreferrer");
    return null;
  },

  ...WINDOW_ANSWERS,
  ...WIZARD_ANSWERS,
  ...PROVIDER_ANSWERS,
};

export const NO_OPS = new Set([
  "web_storage_save",
  "settings_save_sections",
  "onboarding_preferences_save",
  "set_open_monitor",
  "set_click_through_paused",
  "set_outside_click_dismiss",
  "set_interactive_rects",
  "connections_prune",
  "launch_path",
  "reveal_in_file_manager",
  "open_in_terminal",
  "open_windows_search",
  "app_exit",
  "execute_action",
  "settings_file_open",
  "autostart_set",
  "send_virtual_key",
  // Cancels and cleanups for things that never started here.
  "cancel_preview_clip",
  "stop_preview_clip",
  "llm_chat_cancel",
  "quick_action_cancel",
  "credentials_cancel_connect",
  "color_picker_stop",
  "connections_dispose",
  "clipboard_set_revealed",
  "image_widget_clear",
  "runtime_extensions_import_discard",
]);

export const NOT_ON_WEB = new Set<string>([
  // The machine: clipboard history, screen, media session, system sensors.
  "clipboard_list",
  "clipboard_clear",
  "clipboard_delete",
  "clipboard_restore",
  "color_picker_start",
  "widget_system_info",
  "widget_now_playing",
  "now_playing_connect",
  "widget_notification_show",
  "widget_ai_usage",
  "widget_ai_usage_enable_claude",
  "kill_port",
  "fetch_url_icon",
  "load_local_icon",
  "image_widget_import",
  "settings_file_path",
  "focus_tracker_status",
  "focus_tracker_summary",
  "focus_tracker_recent_apps",
  "focus_tracker_list_habit_rules",
  "focus_tracker_list_ignore_rules",
  "focus_tracker_upsert_habit_rule",
  "focus_tracker_upsert_ignore_rule",
  "focus_tracker_delete_habit_rule",
  "focus_tracker_delete_ignore_rule",
  // Share: screen recording and preview capture.
  "preview_recording_availability",
  "record_preview_clip",
  "read_preview_clip",
  "copy_preview_clip",
  "save_preview_clip",
  "capture_preview_image",
  // Accounts and the providers behind them.
  "credential_types_list",
  "credentials_list",
  "credentials_status",
  "credentials_connect",
  "credentials_disconnect",
  "credentials_delete",
  "credentials_save",
  "credentials_test",
  "credentials_retry_access",
  "connections_copy",
  "connections_grant_package",
  "connections_package_types",
  "connections_select",
  "connections_selection",
  "extension_capability_fetch",
  // Models: the Wizard, the quick actions, chat.
  "llm_models",
  "llm_model_set_enabled",
  "llm_quick_model_set",
  "llm_chat_stream",
  "quick_action_ready",
  "quick_action_apply",
  "quick_action_open_widget",
  "quick_action_open_access_settings",
  "quick_action_disabled_templates",
  "quick_action_disabled_templates_set",
  "quick_action_shortcut",
  "quick_action_shortcut_set",
  "quick_action_shortcut_capture",
  // The local MCP server.
  "mcp_server_status",
  "mcp_server_set_enabled",
  "mcp_server_set_port",
  "mcp_server_set_token",
  "mcp_server_retry",
  // Installed (runtime) widget packages and their drafts.
  "runtime_extensions_root",
  "runtime_extensions_export_package",
  "runtime_extensions_import_inspect",
  "runtime_extensions_import_install",
  "runtime_extensions_http_call",
  "runtime_extensions_credential_users",
  "runtime_extensions_revoke_credential",
  "runtime_extensions_set_daily_budget",
  "runtime_extensions_budget_status",
]);

const unanswered = new Set<string>();

/**
 * What a visitor sees where the page cannot follow. The app prints errors with
 * `String(cause)` as often as with `.message`; `toString` makes both the
 * sentence alone, without the "Error: " prefix. The command stays on `command`.
 */
export class DesktopOnly extends Error {
  constructor(readonly command: string) {
    super("This needs the Kavibay desktop app. You're looking at a demo.");
  }

  override toString(): string {
    return this.message;
  }
}

export function webCommand(cmd: string, args: Args): unknown {
  const answer = ANSWERS[cmd];
  if (answer) return answer(args);
  if (NO_OPS.has(cmd)) return null;
  if (NOT_ON_WEB.has(cmd)) {
    throw new DesktopOnly(cmd);
  }
  // Only Tauri's own plugin commands can land here; ours are all classified.
  if (!unanswered.has(cmd)) {
    unanswered.add(cmd);
    console.warn(`[web] unanswered command: ${cmd}`);
  }
  return null;
}
