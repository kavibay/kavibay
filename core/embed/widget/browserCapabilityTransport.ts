import type { WidgetCapabilityTransport } from "../../app/extension-host/widgetCapabilityTransport";
import { wizardFixture } from "./wizardFixture";

/**
 * The capability transport for a page.
 *
 * `WidgetCapabilityTransport` is the seam between a widget and the machine.
 * On the desktop the Tauri implementation answers all 64 methods with the real
 * clipboard, the real launcher, the real screen. A browser has none of that,
 * and this file is deliberate about the difference:
 *
 *   - Anything that needs the operating system **throws**, naming itself. It
 *     does not return an empty list, because a widget that asked for the
 *     clipboard and received `[]` renders an empty clipboard — a screenshot of
 *     a lie. A thrown error reaches the runtime's error panel, which is the
 *     honest outcome and the one a reader can act on.
 *   - The `wizard*` methods are answered from a **fixture script**. They are
 *     the exception because what the Widget Wizard shows is a conversation,
 *     and a conversation can be scripted truthfully: the transcript is stated
 *     to be a demo, no model is called, and nothing is written anywhere.
 *
 * This is the file the plan's W0 calls `browserCapabilityTransport`. It starts
 * here, serving a marketing page, and is the same seam a hosted
 * `start.kavibay.com` would fill in with real answers later.
 */

/** Throws, naming the method, so a widget's failure says what it wanted. */
function absent(method: string): never {
  throw new Error(`${method} needs the desktop app; this page has no such capability`);
}

export const browserCapabilityTransport: WidgetCapabilityTransport = {
  // — AI usage —————————————————————————————————————————————
  aiUsageSnapshot: async () => absent("aiUsage.snapshot"),
  aiUsageEnableClaudeCapture: async () => absent("aiUsage.enableClaudeCapture"),

  // — Notifications, system, media ——————————————————————————
  notificationShow: async () => absent("notification.show"),
  systemInfoSnapshot: async () => absent("systemInfo.snapshot"),
  nowPlayingSnapshot: async () => absent("nowPlaying.snapshot"),
  nowPlayingControl: async () => absent("nowPlaying.control"),
  alarmNotify: async () => absent("alarm.notify"),

  /**
   * The one OS-shaped call a browser can honestly answer. Widgets use it for
   * "open this link", which is what a browser is.
   */
  openExternal: async (url: string) => {
    window.open(url, "_blank", "noopener,noreferrer");
  },

  /**
   * Same tab-opening as above. The host-side check on which provider vouched
   * for the url has already run in `Host.openExternalVouched`; the embed has no
   * Rust backstop underneath it to add a second one.
   */
  openExternalVouched: async (url: string) => {
    window.open(url, "_blank", "noopener,noreferrer");
  },

  // — Clipboard ————————————————————————————————————————————
  clipboardWriteText: async (text: string) => {
    // Writing is allowed: it is a user-initiated copy, not a read of history.
    await navigator.clipboard?.writeText(text);
  },
  clipboardList: async () => absent("clipboard.list"),
  clipboardOnChange: async () => absent("clipboard.onChange"),
  clipboardRestore: async () => absent("clipboard.restore"),
  clipboardSetRevealed: async () => absent("clipboard.setRevealed"),
  clipboardDelete: async () => absent("clipboard.delete"),
  clipboardClear: async () => absent("clipboard.clear"),
  clipboardImageUrl: () => "",

  // — Screen colour ————————————————————————————————————————
  colorPickerStart: async () => absent("colorPicker.start"),
  colorPickerStop: async () => absent("colorPicker.stop"),

  // — Local files ——————————————————————————————————————————
  imagePick: async () => absent("image.pick"),
  imageImport: async () => absent("image.import"),
  imageClear: async () => absent("image.clear"),
  imageUrl: () => "",

  // — Launcher —————————————————————————————————————————————
  launcherPick: async () => absent("launcher.pick"),
  launcherListInstalled: async () => absent("launcher.listInstalled"),
  launcherExtractIcon: async () => absent("launcher.extractIcon"),
  launcherLoadIcon: async () => absent("launcher.loadIcon"),
  launcherFetchUrlIcon: async () => absent("launcher.fetchUrlIcon"),
  launcherLaunch: async () => absent("launcher.launch"),
  launcherSendKey: async () => absent("launcher.sendKey"),

  // — Focus tracker ————————————————————————————————————————
  focusTrackerStatus: async () => absent("focusTracker.status"),
  focusTrackerSummary: async () => absent("focusTracker.summary"),
  focusTrackerListHabitRules: async () => absent("focusTracker.listHabitRules"),
  focusTrackerUpsertHabitRule: async () => absent("focusTracker.upsertHabitRule"),
  focusTrackerDeleteHabitRule: async () => absent("focusTracker.deleteHabitRule"),
  focusTrackerRecentApps: async () => absent("focusTracker.recentApps"),
  focusTrackerListIgnoreRules: async () => absent("focusTracker.listIgnoreRules"),
  focusTrackerUpsertIgnoreRule: async () => absent("focusTracker.upsertIgnoreRule"),
  focusTrackerDeleteIgnoreRule: async () => absent("focusTracker.deleteIgnoreRule"),

  // — LLM ——————————————————————————————————————————————————
  // No key on a marketing page, and no proxy behind it. A hosted runtime is
  // where these become answerable; see the plan's W0.
  llmModels: async () => absent("llm.models"),
  llmQuickModel: async () => absent("llm.quickModel"),
  llmStream: async () => absent("llm.stream"),
  llmCancel: async () => absent("llm.cancel"),

  // — Widget Wizard, from the fixture script ————————————————
  ...wizardFixture,
};
