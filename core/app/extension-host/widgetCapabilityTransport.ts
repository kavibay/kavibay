import type {
  AlarmNotification,
  ColorPickerEvent,
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
  WizardCompletionRequest,
  WidgetInstanceId,
} from "@sdk/contract/sdk";

/**
 * The last hop for reviewed host capabilities.
 *
 * This is deliberately separate from ProviderTransport: provider transport
 * owns network/credential traffic, while these methods expose fixed OS
 * surfaces. Keeping the seam injectable lets the contract host stay runnable
 * under the assertion suite without Tauri.
 */
export interface WidgetCapabilityTransport {
  aiUsageSnapshot(): Promise<unknown>;
  aiUsageEnableClaudeCapture(): Promise<unknown>;
  notificationShow(request: NotificationRequest): Promise<void>;
  systemInfoSnapshot(): Promise<unknown>;
  nowPlayingSnapshot(): Promise<unknown>;
  nowPlayingControl(action: NowPlayingControl): Promise<void>;
  alarmNotify(instanceId: WidgetInstanceId, mode: AlarmNotification): Promise<void>;
  openExternal(url: string): Promise<void>;
  /**
   * Opens a url a *provider* vouched for, for widgets that hold no
   * `openExternal` capability of their own. Rust re-checks the host against the
   * compiled provider list before the browser sees it.
   */
  openExternalVouched(url: string): Promise<void>;
  clipboardWriteText(text: string): Promise<void>;
  clipboardList(): Promise<unknown>;
  clipboardRestore(id: string): Promise<void>;
  clipboardSetRevealed(id: string, revealed: boolean): Promise<void>;
  clipboardDelete(id: string): Promise<void>;
  clipboardClear(): Promise<void>;
  clipboardImageUrl(path: string): string;
  colorPickerStart(onEvent: (event: ColorPickerEvent) => void): Promise<() => void>;
  colorPickerStop(): Promise<void>;
  imagePick(): Promise<string | null>;
  imageImport(instanceId: WidgetInstanceId, sourcePath: string): Promise<string>;
  imageClear(instanceId: WidgetInstanceId): Promise<void>;
  imageUrl(path: string): string;
  launcherPick(kind: "file" | "folder" | "image"): Promise<string[]>;
  launcherListInstalled(): Promise<unknown>;
  launcherExtractIcon(path: string): Promise<string>;
  launcherLoadIcon(path: string): Promise<string>;
  launcherFetchUrlIcon(url: string): Promise<string>;
  launcherLaunch(path: string): Promise<void>;
  launcherSendKey(keyId: string): Promise<void>;
  focusTrackerStatus(): Promise<unknown>;
  focusTrackerSummary(range: FocusTrackerRange, groupBy: FocusTrackerGroupBy): Promise<unknown>;
  focusTrackerListHabitRules(): Promise<unknown>;
  focusTrackerUpsertHabitRule(appName: string, limitMinutes: number): Promise<unknown>;
  focusTrackerDeleteHabitRule(id: number): Promise<void>;
  focusTrackerRecentApps(limit?: number): Promise<unknown>;
  focusTrackerListIgnoreRules(): Promise<unknown>;
  focusTrackerUpsertIgnoreRule(kind: FocusTrackerIgnoreKind, value: string): Promise<unknown>;
  focusTrackerDeleteIgnoreRule(id: number): Promise<void>;
  llmModels(instanceId?: string): Promise<unknown>;
  llmQuickModel(): Promise<unknown>;
  llmStream(
    instanceId: WidgetInstanceId,
    request: LlmChatRequest,
    onEvent: (event: LlmStreamEvent) => void,
    owner?: string,
  ): Promise<void>;
  llmCancel(requestId: string): Promise<void>;
  wizardModels(instanceId?: string): Promise<unknown>;
  wizardComplete(request: WizardCompletionRequest, instanceId?: string): Promise<unknown>;
  /** One declared endpoint of one package, executed by the Rust broker. */
  runtimeHttpCall?(extId: string, endpointId: string, args: Record<string, unknown>, instanceId: string): Promise<unknown>;
  wizardConversationsList(): Promise<unknown>;
  wizardConversationLoad(id: string): Promise<unknown>;
  wizardConversationSave(conversation: unknown): Promise<void>;
  wizardConversationDelete(id: string): Promise<void>;
  wizardRuntimeScan(): Promise<unknown>;
  wizardRuntimeInstalls(): Promise<unknown>;
  wizardRuntimeEntryUrl(id: string, entry: string): string;
  wizardRuntimeSetEnabled(
    id: string,
    enabled: boolean,
    manifestPermissions: string[],
    contractGrant?: unknown,
  ): Promise<void>;
  wizardRuntimeReadPackage(id: string): Promise<unknown>;
  wizardRuntimeDeletePackage(id: string): Promise<void>;
  /**
   * Ask for a place to put the widget, then write a zip of its files there.
   *
   * The dialog belongs on this side of the seam, which is why the id is the
   * only argument: a widget that could name the path would be a widget that
   * could write a file anywhere. `null` is a dismissed dialog.
   */
  wizardExportPackage(id: string): Promise<WidgetExportReport | null>;
  /**
   * One declared endpoint, called once, so the wizard can show what it
   * actually returns.
   *
   * `extId` is the same value the preview frame is mounted with — a
   * `__draft__`-prefixed id while the package is unsaved, the real id after —
   * so this reaches exactly what the preview could already reach and nothing
   * more. Rust decides the rest: the declaration, the allowlist, https-only,
   * the private-address refusal and, for a draft, the flat refusal of any
   * endpoint that wants a credential.
   */
  wizardEndpointCall(extId: string, endpointId: string, args: unknown): Promise<unknown>;
  wizardDrafts(): Promise<unknown>;
  wizardDraftRead(id: string): Promise<unknown>;
  wizardDraftOpen(id: string): Promise<unknown>;
  wizardOnDraftChanged(handler: (event: DraftChanged) => void): Promise<() => void>;
  wizardDraftPresence(): Promise<unknown>;
  wizardOnDraftPresenceChanged(handler: (event: DraftPresence) => void): Promise<() => void>;
  wizardDraftWrite(id: string, files: unknown, expectedRevision?: string | null): Promise<unknown>;
  wizardDraftPromote(id: string, replaces?: string | null): Promise<unknown>;
  wizardDraftDiscard(id: string): Promise<void>;
}
