import type { ActionParam } from "@sdk/types";

export interface Command {
  id: string;
  title: string;
  subtitle?: string;
  /** Additional search terms matched by fuzzyMatch alongside the title. */
  keywords: string[];
  /**
   * Parameters requested with Tab before execution.
   * Empty or missing means Enter executes immediately.
   * (Extension actions live on their widget row rather than here.)
   */
  params?: ActionParam[];
  /**
   * Tauri command invoked instead of `execute_action` for commands whose Rust
   * implementation already exists (media transport).
   */
  invokeCommand?: string;
}

/** Static prototype commands — execute_action() only prints in V1. */
export const commands: Command[] = [
  // "New Note" lives on the Notes extension row as an action (Tab) — a static
  // command here would be a second row for the same thing, and it forced a
  // hardcoded addWidget("notes") into the palette.
  {
    id: "open-settings",
    title: "Settings",
    subtitle: "Open settings",
    keywords: ["settings", "preferences"],
  },
  {
    id: "open-settings-appearance",
    title: "Appearance",
    subtitle: "Settings",
    keywords: ["settings", "theme", "fonts", "typeface", "colors"],
  },
  {
    id: "open-settings-behavior",
    title: "Behavior",
    subtitle: "Settings",
    keywords: ["settings", "preferences", "interaction"],
  },
  {
    id: "open-settings-extensions",
    title: "Extensions",
    subtitle: "Settings",
    keywords: ["settings", "widgets", "plugins"],
  },
  {
    id: "open-settings-ai",
    title: "AI",
    subtitle: "Settings",
    keywords: ["settings", "llm", "models", "anthropic", "openai", "cloudflare", "claude", "gpt"],
  },
  {
    id: "open-settings-credentials",
    title: "Credentials",
    subtitle: "Settings",
    keywords: ["settings", "api", "keys", "tokens", "integrations"],
  },
  // Deliberately not `open-settings-*`: the dispatcher treats that prefix as
  // "open this Settings section", so an id shaped like the others would be
  // routed into the modal with `file` as a section name.
  {
    id: "settings-open-file",
    title: "Open settings.json",
    subtitle: "Edit the settings file in your editor",
    keywords: ["settings", "json", "config", "configuration", "edit", "file"],
  },
  {
    id: "settings-reveal-folder",
    title: "Reveal Settings Folder",
    subtitle: "Show settings.json in the file manager",
    keywords: ["settings", "folder", "appdata", "data", "reveal", "explorer"],
  },
  {
    id: "open-gallery",
    title: "Widget Gallery",
    subtitle: "Browse widgets with video previews",
    keywords: ["gallery", "widgets", "browse", "add", "onboarding"],
  },
  {
    id: "search-google",
    title: "Search Google",
    subtitle: "Open Google in the browser (prefix: g / google)",
    keywords: ["google", "search", "web", "g", "browser"],
  },
  {
    id: "search-files",
    title: "Search Files",
    subtitle: "Open Windows Search (prefix: f)",
    keywords: ["files", "folders", "search", "find", "explorer", "f"],
  },
  {
    id: "open-browser",
    title: "Open Browser",
    subtitle: "Launch the default web browser",
    keywords: ["browser", "web", "internet", "chrome", "firefox"],
  },
  {
    id: "sleep",
    title: "Sleep",
    subtitle: "Put the computer to sleep",
    keywords: ["sleep", "suspend", "power"],
  },
  {
    id: "lock-screen",
    title: "Lock Screen",
    subtitle: "Lock the current session",
    keywords: ["lock", "screen", "security"],
  },
  {
    id: "set-volume",
    title: "Set Volume",
    subtitle: "Set the system output volume",
    keywords: ["volume", "sound", "audio", "loud", "vol"],
    params: [
      {
        name: "level",
        type: "number",
        required: true,
        placeholder: "Volume (0-100)",
      },
    ],
  },
  {
    id: "toggle-mute",
    title: "Toggle Mute",
    subtitle: "Mute or unmute system audio",
    keywords: ["mute", "unmute", "silence", "volume", "sound"],
  },
  // Media transport reuses the Now Playing backend — no execute_action detour.
  {
    id: "media-play-pause",
    title: "Play / Pause",
    subtitle: "Toggle playback in the active player",
    keywords: ["play", "pause", "media", "music", "spotify"],
    invokeCommand: "now_playing_play_pause",
  },
  {
    id: "media-next",
    title: "Next Track",
    subtitle: "Skip to the next track",
    keywords: ["next", "skip", "track", "media", "music"],
    invokeCommand: "now_playing_next",
  },
  {
    id: "media-previous",
    title: "Previous Track",
    subtitle: "Go back to the previous track",
    keywords: ["previous", "prev", "back", "track", "media", "music"],
    invokeCommand: "now_playing_prev",
  },
  {
    id: "empty-clipboard",
    title: "Empty Clipboard",
    subtitle: "Clear the system clipboard",
    keywords: ["clipboard", "clear", "copy", "paste"],
  },
  {
    id: "toggle-dark-mode",
    title: "Toggle Dark Mode",
    subtitle: "Switch between light and dark appearance",
    keywords: ["dark", "mode", "theme", "appearance"],
  },
  {
    id: "enable-demo-mode",
    title: "Enable Demo",
    subtitle: "Show pressed hotkeys at the bottom of the screen",
    keywords: ["demo", "hotkeys", "keys", "presentation", "show"],
    invokeCommand: "enable_demo_mode",
  },
  {
    id: "disable-demo-mode",
    title: "Disable Demo",
    subtitle: "Stop showing pressed hotkeys",
    keywords: ["demo", "hotkeys", "keys", "presentation", "hide"],
    invokeCommand: "disable_demo_mode",
  },
  {
    id: "replay-onboarding",
    title: "Replay Tour",
    subtitle: "Show the getting-started tour again",
    keywords: ["onboarding", "tour", "tutorial", "guide", "replay"],
  },
];
