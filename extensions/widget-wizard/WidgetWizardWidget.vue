<script setup lang="ts">
/**
 * Widget Wizard: describe a widget in plain language, watch it appear.
 *
 * Three columns — conversations, chat, preview — because the three things a
 * person does here (pick up where they left off, ask, look) are not steps in a
 * sequence and shouldn't take turns occupying one panel.
 *
 * The wizard never writes files itself. It asks a model for text, parses the
 * files out of that text, and hands them to `runtime_extensions_draft_write` —
 * the one command that cannot leave the custom drafts directory. So the worst a
 * bad generation can produce is a broken draft, never a damaged widget the
 * person already trusts with credentials.
 */
import {
  computed,
  h,
  inject,
  nextTick,
  onMounted,
  onUnmounted,
  ref,
  render,
  type Component,
  watch,
} from "vue";
import type { DraftChanged, DraftPresence, WizardCapability } from "@sdk/contract/sdk";
import type { WizardPreviewElement } from "@sdk/wizardPreview";
import { pointAndPromptParts, pointAndPromptRequest, pointAndPromptTranscript, splitPreviewTranscript, type PreviewSelection, type PreviewTranscriptPart } from "./wizardPointAndPrompt";
import {
  BracesIcon,
  BrainIcon,
  CodeXmlIcon,
  FileCodeIcon,
  FileIcon,
  FolderIcon,
  HashIcon,
  IconBase,
  ImageIcon,
  MessageSquareIcon,
  PanelLeftIcon,
  PlugIcon,
  ServerPlusIcon,
  SquarePenIcon,
  UnplugIcon,
} from "@sdk/icons";
import { BrandMark, McpClientMark, brandMarkFor } from "@sdk/brand";
import KavibaySelect from "@sdk/KavibaySelect.vue";
import WizardModelMenu from "./WizardModelMenu.vue";
import WizardMcpHelp from "./WizardMcpHelp.vue";
import WizardChevron from "./WizardChevron.vue";
import WizardGenerationStatus from "./WizardGenerationStatus.vue";
import WizardSuggestions from "./WizardSuggestions.vue";
import WizardConversationMenu from "./WizardConversationMenu.vue";
import { appendWizardSuggestion, currentWizardSuggestions, type WizardSuggestion } from "./wizardSuggestions";
import WizardPreviewStage, { type PreviewFault } from "./WizardPreviewStage.vue";
import { takeNewProjectRequest, type WidgetWizardModel } from "./widgets/widgetWizard";
import {
  WIDGET_FOCUS_EVENT,
  widgetFocusRequestMatches,
  type WidgetFocusRequestDetail,
} from "@sdk/widgetFocusRequest";
import { tokenize, type CodeToken } from "./highlight";
import { storageReadProblems } from "./storageReadProblems";
import {
  REPAIR_BUDGET,
  NO_USAGE,
  describeReply,
  effortForModel,
  freshInput,
  addCost,
  addUsage,
  applyDraftPresence,
  applyDraftSnapshot,
  estimateCost,
  formatCost,
  formatTokens,
  readUsage,
  mergeGeneratedFiles,
  withoutOtherFormat,
  recordVersion,
  updateLiveVersion,
  endpointsToProbe,
  fileKind,
  fileTreeRows,
  highlightLanguage,
  argSignature,
  actionUses,
  describeResultShape,
  providerCallsIn,
  providersUsedBy,
  queryUses,
  providerUseState,
  type FileKind,
  type ProviderUseState,
  sampleBody,
  faultProblem,
  repairTurnFor,
  attachmentProblem,
  base64FromDataUrl,
  consentPreviewFor,
  defaultWizardModel,
  describeDraftError,
  describeExportError,
  describeWizardError,
  draftSyncDecision,
  isContractPackageFiles,
  keepMineExpectedRevision,
  lintGeneratedFiles,
  manifestScale,
  manifestSize,
  packageIdFor,
  declaredPackageId,
  declaredDisplayName,
  freePackageId,
  previewPermissionsFor,
  parseGeneratedFiles,
  replyProblem,
  sortWizardModels,
  withPackageId,
  queueDraftConflict,
  turnForPackage,
  withDefaultScale,
  withDefaultSize,
  askedNothingNew,
  autoApprovedGrant,
  canAutoApprove,
  unmetProviders,
  buildWizardPermissionRequest,
  consentLinesFor,
  needsReviewBeforeEnable,
  type GeneratedFile,
  type ConsentEndpoint,
  type WizardApprovedGrant,
  type WizardPermissionRequest,
  type WizardProviderSchema,
  type WidgetFormat,
  type WizardAttachment,
  type WizardBubble,
  type DraftVersion,
  type DraftConflict,
  type DraftSyncEvent,
  type WizardCost,
  type WizardUsage,
  type EndpointProbe,
  type EndpointSample,
  type WizardModelOption,
  type WizardDraftSnapshot,
  type DraftAuthor,
  type DraftClient,
  type WizardDraftPresence,
  type ProjectRow,
  type ConversationHeader,
  conversationLabel,
  isPlainNote,
  appendNote,
  conversationTitle,
  buildProjectRows,
  describeDraftAuthor,
  describeDraftClient,
  describeDraftPresence,
  draftAuthorOf,
  draftAuthorWithClientName,
  presenceForWidget,
  describeDraftUpdate,
  describeDraftOpen,
  describeAge,
  describeProjectStatus as describeProjectStatusAt,
  projectIsLive,
  orderProjects,
  nextProjectOrder,
  moveProject,
  dropProject,
  splitProviderMentions,
  wizardPlatforms,
  wizardHasAnyKey,
  type MentionSegment,
} from "./widgetWizardLogic";

interface DraftSummary {
  id: string;
  files: string[];
  revision: string;
  error: string | null;
  /** Set when the write moved the draft, because its manifest renamed it. */
  renamedFrom?: string;
  lastWriter: DraftAuthor;
  lastClient?: DraftClient;
  lastClientName?: string | null;
  updatedAt: number | null;
}

type DraftSnapshot = WizardDraftSnapshot;

/** What `draftOpen` found: an existing draft, or a fresh checkout. */
interface DraftOpen {
  snapshot: DraftSnapshot;
  existing: boolean;
}

interface RuntimeInstallRecord {
  id: string;
  enabled: boolean;
  grantedPermissions: string[];
  /** Credential types this package may inject, granted at enable time. */
  grantedCredentials?: string[];
  /** Hash of the `api.json` the grant was given for. */
  apiHash?: string | null;
  /**
   * Every spelling, because this reads a record the backend may not have
   * rewritten yet. `approved` is current; the other two are pre-§27 shapes.
   */
  contractGrant?: {
    approved?: string[];
    actions?: Record<string, string[]>;
    providers?: { provider: string; queries: string[] }[];
    provider?: string;
    queries?: string[];
  };
}

interface ScannedRuntimeExtension {
  id: string;
  name: string;
  /** When the package folder was last written — for a custom widget, its Save. */
  updatedAt?: number | null;
  origin: "installed" | "custom";
  format: "runtime" | "contract";
  permissions: string[];
  apiEndpoints: ConsentEndpoint[];
  contractManifest?: unknown;
  status: string;
}

const props = defineProps<{ model: WidgetWizardModel }>();
const wizard: WizardCapability = props.model.wizard;
const saveShortcutTip = /Mac|iPhone|iPad/.test(
  typeof navigator === "undefined" ? "" : navigator.platform || navigator.userAgent,
) ? "Save (⌘S)" : "Save (Ctrl+S)";
const {
  headers,
  active: session,
  refresh,
  start,
  load,
  save,
  saveDraftSoon,
  remove,
} = props.model.conversations;
/**
 * Column widths, in pixels.
 *
 * Kept in `ctx.data` rather than in the conversation: how wide you like the
 * file editor is a property of this Wizard on this desk, not of the widget you
 * happened to be building when you dragged it.
 *
 * Pixels rather than fractions because that is what a drag produces. The middle
 * column stays `1fr` and absorbs the remainder, so the window can be resized
 * without the panels the person set drifting.
 */
const SIDE_MIN = 140;
const SIDE_MAX = 340;
const PREVIEW_MIN = 240;
const PREVIEW_MAX = 720;
const LAYOUT_KEY = "wizard:layout";

const sideWidth = ref(180);
const previewWidth = ref(360);
const sidebarCollapsed = ref(false);
const showSuggestions = ref(true);

/**
 * Arrived here from the palette to start a widget, and nothing else.
 *
 * The Wizard's chrome — a list of projects, a name field, a Conversation/Files
 * switch — is all about a package that does not exist yet. Somebody who pressed
 * "New Widget" has one thing to do, and every one of those is a thing to look
 * past first. It is *not* stored: the collapse the person chose for this card
 * lives in `ctx.data` and must survive being briefly overruled, so this is a
 * separate flag that folds the chrome away and then gets out of the way.
 */
const composing = ref(false);

/**
 * The sidebar, folded away until it is asked for.
 *
 * Separate from `composing` because the two end at different moments. The
 * header describes a package, so it comes back when there is one. The sidebar
 * is a list of *other* projects, and finishing this one is not a reason to be
 * shown them — the widget that just appeared is the thing to look at.
 *
 * Like `composing`, deliberately not stored: the collapse the person chose for
 * this card lives in `ctx.data` and has to survive being overruled.
 */
const sidebarTucked = ref(false);

const sidebarHidden = computed(() => sidebarCollapsed.value || sidebarTucked.value);

/**
 * The header comes back on its own once there is something for it to describe.
 *
 * A package means the name field names something and Files has files in it, so
 * the reason for hiding them has expired. No end-of-mode button: a mode you
 * have to leave is one people end up stuck in.
 *
 * The sidebar is not part of this. It stays folded until it is asked for.
 */
watch(
  () => Boolean(session.value.draftFiles?.length),
  (hasPackage) => {
    if (hasPackage) composing.value = false;
  },
);

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Math.round(value)));

void props.model.data
  .get<{ side?: number; preview?: number; collapsed?: boolean; showSuggestions?: boolean }>(LAYOUT_KEY)
  .then((saved) => {
    if (!saved) return;
    if (typeof saved.side === "number") sideWidth.value = clamp(saved.side, SIDE_MIN, SIDE_MAX);
    if (typeof saved.preview === "number") {
      previewWidth.value = clamp(saved.preview, PREVIEW_MIN, PREVIEW_MAX);
    }
    if (typeof saved.collapsed === "boolean") sidebarCollapsed.value = saved.collapsed;
    if (typeof saved.showSuggestions === "boolean") showSuggestions.value = saved.showSuggestions;
  });

function saveLayout() {
  void props.model.data.set(LAYOUT_KEY, {
    side: sideWidth.value,
    preview: previewWidth.value,
    collapsed: sidebarCollapsed.value,
    showSuggestions: showSuggestions.value,
  });
}

/**
 * The card's own width, watched.
 *
 * WHY THIS IS NOT OPTIONAL. The side columns are pixels and the middle is
 * `1fr`, and `minmax(220px, 1fr)` does **not** protect it: when the fixed
 * tracks add up to more than the container, a grid overflows rather than
 * shrinking them, and the free space `1fr` divides is zero. The middle column
 * collapses to nothing, its tabs and composer overflow visibly because they do
 * not wrap, and only the transcript shows what happened — one character per
 * line down the left edge.
 *
 * The Wizard is a widget on a desk, so its width is whatever the person
 * dragged it to. A width remembered on a large card and restored on a small one
 * is the ordinary case, not an edge case.
 */
const wizEl = ref<HTMLElement | null>(null);
const wizWidth = ref(0);

onMounted(() => {
  if (!wizEl.value) return;
  const observer = new ResizeObserver(([entry]) => {
    wizWidth.value = entry?.contentRect.width ?? 0;
  });
  observer.observe(wizEl.value);
  onUnmounted(() => observer.disconnect());
});

/** What the fixed columns may take before the middle stops being usable. */
const MIDDLE_MIN = 220;
/** The grid's own `gap: 10px`, four times over — it is not free width. */
const GAPS = 40;

const effectiveSide = computed(() => {
  if (wizWidth.value === 0) return sideWidth.value;
  const room = wizWidth.value - MIDDLE_MIN - effectivePreview.value - GAPS;
  return clamp(Math.min(sideWidth.value, Math.max(0, room)), 0, SIDE_MAX);
});

const effectivePreview = computed(() => {
  if (wizWidth.value === 0) return previewWidth.value;
  const sideReservation = sidebarHidden.value ? 0 : SIDE_MIN;
  const room = wizWidth.value - MIDDLE_MIN - sideReservation - GAPS;
  return clamp(Math.min(previewWidth.value, Math.max(0, room)), 0, PREVIEW_MAX);
});

/**
 * Below this the three-column idea stops being one. Rather than shave every
 * column to a sliver, the preview keeps the card and the rest folds away — a
 * narrow Wizard is still a Wizard, a crushed one is not.
 */
const tooNarrow = computed(() => wizWidth.value > 0 && wizWidth.value < 620);

const gridColumns = computed(() => {
  if (tooNarrow.value) return "0px 0px minmax(0, 1fr) 0px 0px";
  if (sidebarHidden.value) {
    return `0px 6px minmax(${MIDDLE_MIN}px, 1fr) 6px ${effectivePreview.value}px`;
  }
  return `${effectiveSide.value}px 6px minmax(${MIDDLE_MIN}px, 1fr) 6px ${effectivePreview.value}px`;
});

function toggleSidebar() {
  // Asking for the sidebar unfolds it: the request is unambiguous, and a toggle
  // that appeared to do nothing would be the worse answer. This is also the
  // only way out of the tucked state, which is why it cannot be conditional.
  if (sidebarTucked.value) {
    sidebarTucked.value = false;
    sidebarCollapsed.value = false;
    saveLayout();
    return;
  }
  sidebarCollapsed.value = !sidebarCollapsed.value;
  saveLayout();
}

/**
 * One drag, for either handle.
 *
 * Pointer capture rather than window listeners: the pointer keeps reporting to
 * the handle even when it leaves it, which is what makes a fast drag not stop
 * halfway. The preview handle moves the *right* edge inward, so its delta is
 * inverted.
 */
function startDrag(which: "side" | "preview", event: PointerEvent) {
  if (which === "side" && sidebarHidden.value) return;
  const handle = event.currentTarget as HTMLElement;
  const startX = event.clientX;
  const startWidth = which === "side" ? sideWidth.value : previewWidth.value;
  let moved = false;
  handle.setPointerCapture(event.pointerId);

  const move = (moveEvent: PointerEvent) => {
    const delta = moveEvent.clientX - startX;
    if (Math.abs(delta) > 3) moved = true;
    if (!moved) return;
    if (which === "side") {
      sideWidth.value = clamp(startWidth + delta, SIDE_MIN, SIDE_MAX);
    } else {
      previewWidth.value = clamp(startWidth - delta, PREVIEW_MIN, PREVIEW_MAX);
    }
  };
  const end = () => {
    handle.releasePointerCapture(event.pointerId);
    handle.removeEventListener("pointermove", move);
    handle.removeEventListener("pointerup", end);
    handle.removeEventListener("pointercancel", end);
    saveLayout();
  };

  handle.addEventListener("pointermove", move);
  handle.addEventListener("pointerup", end);
  handle.addEventListener("pointercancel", end);
}

/** Keyboard equivalent, so the layout is not mouse-only. */
function nudge(which: "side" | "preview", direction: -1 | 1) {
  if (which === "side") sideWidth.value = clamp(sideWidth.value + direction * 16, SIDE_MIN, SIDE_MAX);
  else previewWidth.value = clamp(previewWidth.value - direction * 16, PREVIEW_MIN, PREVIEW_MAX);
  saveLayout();
}

const permissionRequestHost = inject<Component>("kavibay:widget-wizard-permission-request");
const wizardAutoEnable = ref(false);
/** The gate the bypass lives behind; without it the switch is not offered. */
const developerExtensions = ref(false);

/**
 * Arm the bypass from the dialog it skips.
 *
 * The host normalises against Developer Extensions and answers with what the
 * setting ended up as, so a request it refused shows as refused rather than
 * leaving a switch that looks on and does nothing.
 */
async function setAutoApprove(on: boolean): Promise<void> {
  wizardAutoEnable.value = await wizard.setDeveloperConsentBypass(on);
}
const installs = ref<RuntimeInstallRecord[]>([]);
const scanned = ref<ScannedRuntimeExtension[]>([]);
const providerSchemas = ref<WizardProviderSchema[]>([]);
const providerConnected = ref(new Map<string, boolean>());

// Typing is not a send, but losing it still costs someone their sentence.
watch(
  () => session.value.draft,
  () => saveDraftSoon(session.value),
);
const models = ref<WizardModelOption[]>([]);

/**
 * The package format, derived from the accounts rather than chosen.
 *
 * There used to be a dropdown for it — "Standalone" or "Reads an account" —
 * beside the account picker, which asked the person to state twice what they
 * had already decided once. Worse, the two could disagree: picking tado° while
 * the format said Standalone produced a widget told to write `api.json`
 * endpoints for an account it had, and the person had no way to know which of
 * their two answers the model would follow.
 *
 * Ticking an account *is* choosing the format. Nothing else can express the
 * difference, so nothing else needs to ask about it.
 *
 * A stored session keeps whatever it was authoring, and this recomputes it on
 * every read — a conversation resumed with its accounts still ticked stays a
 * contract package, and one with none becomes standalone, which is what its
 * files already were.
 */
const format = computed(
  (): WidgetFormat =>
    (session.value.providers ?? []).length > 0 ? "contract-package" : "runtime-package",
);

/**
 * The providers a contract widget can read from.
 *
 * Read from the host rather than from `docs/provider-schema.md`: the generated
 * document is for people, and a second reader of a generated file is a second
 * thing that can be stale.
 *
 * A provider that needs an account and has none is offered anyway, with the
 * state shown. Refusing to list it would leave the person guessing why the
 * widget they want is impossible; naming it points at Settings instead.
 */
const providerOptions = computed(() =>
  providerSchemas.value.map((schema) => ({
    id: schema.id,
    label: schema.displayName,
    connected: !schema.requiresCredential || providerConnected.value.get(schema.id) === true,
    credentialType: schema.credentialType,
  })),
);


/**
 * Which accounts this widget reads from. Several, not one.
 *
 * A dropdown could only ever say "this widget reads tado°", and the widget
 * people actually ask for — room temperatures next to the outdoor temperature —
 * reads two. Ticking is also the honest shape for the question: the person is
 * not choosing between accounts, they are saying which ones are involved.
 *
 * Cleared when the format goes back to a standalone widget: picks left behind
 * would be sent with a turn that has no provider section, which reads from the
 * stored session as though they had been chosen for it.
 */
const selectedProviders = computed<string[]>({
  get: () => session.value.providers ?? [],
  set: (value: string[]) => {
    session.value.providers = value.length > 0 ? [...value] : undefined;
  },
});

function toggleProvider(id: string, on: boolean) {
  const next = selectedProviders.value.filter((entry) => entry !== id);
  // Appended rather than sorted, so the order in the prompt is the order the
  // person ticked them — which is usually the order they described them in.
  if (on) next.push(id);
  selectedProviders.value = next;
}

/**
 * Open Settings on the credential this provider uses.
 *
 * The row itself still toggles selection — you can author against an account
 * you have not connected yet. The unplug is the door to connecting it.
 */
function openProviderSettings(option: { credentialType?: string }, event: Event): void {
  event.preventDefault();
  event.stopPropagation();
  if (accountsEl.value) accountsEl.value.open = false;
  closeIntegrationMenu();
  wizard.openSettings("credentials", option.credentialType);
}

/**
 * "tado°, Weather (Open-Meteo)" for the collapsed button — or what it is for.
 *
 * Empty used to read "Standalone", which names the *result* of not having
 * picked anything. Nobody opens a menu to keep a widget standalone; they open
 * it looking for the accounts a widget can read from, and a control labelled
 * with the state it is already in does not say that it is the way to change it.
 */
const selectedProviderLabel = computed(() => {
  const names = selectedProviders.value.map(
    (id) => providerOptions.value.find((option) => option.id === id)?.label ?? id,
  );
  return names.length === 0 ? "Integrations" : names.join(", ");
});

const selectedProviderAria = computed(() =>
  selectedProviders.value.length === 0
    ? "Integrations: none selected"
    : `Integrations: ${selectedProviderLabel.value}`,
);

const myWidgets = ref<{ id: string; name: string; updatedAt: number | null }[]>([]);
const drafts = ref<DraftSummary[]>([]);
const draftPresences = ref<WizardDraftPresence[]>([]);
const presenceNow = ref(Date.now());

function handleDraftPresence(event: DraftPresence): void {
  draftPresences.value = applyDraftPresence(draftPresences.value, event);
  presenceNow.value = Date.now();
}

async function refreshDraftPresence(): Promise<void> {
  try {
    draftPresences.value = await wizard.draftPresence<DraftPresence[]>();
    presenceNow.value = Date.now();
  } catch {
    // Presence is advisory. A transport hiccup must not affect draft editing.
  }
}

function widgetPresence(id: string | null | undefined): WizardDraftPresence | null {
  return presenceForWidget(draftPresences.value, id, presenceNow.value);
}

const activePresence = computed(() => widgetPresence(session.value.packageId));

function presenceAuthor(presence: WizardDraftPresence | null): DraftAuthor {
  if (!presence) return null;
  return draftAuthorWithClientName(presence.client ?? "mcp", presence.clientName);
}

function presenceMark(presence: WizardDraftPresence | null): "codex" | "claude" {
  return presenceAuthor(presence) === "claude" ? "claude" : "codex";
}

function presenceTitle(presence: WizardDraftPresence | null): string {
  if (!presence) return "";
  return `${describeDraftPresence(presence)} · Last MCP action: ${presence.tool}`;
}

/** Persistent attribution after the short-lived presence indicator expires. */
function projectDraftMark(row: ProjectRow): "codex" | "claude" | null {
  if (!row.draft) return null;
  const author = draftAuthorWithClientName(row.author, row.clientName);
  return author === "codex" || author === "claude" ? author : null;
}

function projectDraftTitle(row: ProjectRow): string {
  return describeProjectStatus(row);
}

/**
 * The sidebar: one row per widget, merged from the three places a widget can
 * currently be. Which of them a row came from is a storage detail; what the
 * row says is whether there is unsaved work and who left it there.
 */
/**
 * The conversation on screen, as the list sees it.
 *
 * A conversation is written to disk on its first real content, so pressing
 * "+ New project" produced nothing at all in the sidebar — no row, and
 * therefore no selection either — until something had been typed into it. The
 * project exists from the moment it is created; it simply has nothing in it
 * yet, and a list that cannot show that is a list you have to take on faith.
 */
const activeHeader = computed<ConversationHeader | null>(() => {
  if (headers.value.some((header) => header.id === session.value.id)) return null;
  return {
    id: session.value.id,
    title: conversationTitle(session.value),
    updatedAt: Date.now(),
    packageId: session.value.packageId,
  };
});

const projectRows = computed(() =>
  orderProjects(
    buildProjectRows({
      widgets: myWidgets.value,
      drafts: drafts.value,
      conversations: activeHeader.value
        ? [activeHeader.value, ...headers.value]
        : headers.value,
    }),
    projectOrder.value,
  ),
);

/**
 * The order the person arranged, in the extension-scoped store.
 *
 * Not `ctx.data`: that is this card on this desk, and the arrangement of a
 * project list is not a property of the window it is being read in.
 */
const PROJECT_ORDER_KEY = "projectOrder";
const projectOrder = ref<string[]>([]);
const shared = props.model.shared;

async function hydrateProjectOrder(): Promise<void> {
  const stored = await shared?.get<unknown>(PROJECT_ORDER_KEY).catch(() => undefined);
  projectOrder.value = Array.isArray(stored)
    ? stored.filter((key): key is string => typeof key === "string")
    : [];
}

/**
 * Record the order that is on screen.
 *
 * On every rebuild, not only on a drag: a project that is merely *shown* at the
 * top because nothing has placed it yet would move again as soon as the next one
 * was created, which is the opposite of the promise the list makes.
 */
watch(
  projectRows,
  (rows) => {
    const next = nextProjectOrder(rows, projectOrder.value);
    if (!next) return;
    commitOrder(next);
  },
  // `immediate`, or the first render never records anything: a watcher without
  // it fires on the next *change*, so the stored order stayed empty until
  // something else happened — and a move resolved against an empty order moves
  // nothing, which is exactly what reordering did.
  { immediate: true },
);

function reorder(key: string, delta: number): void {
  commitOrder(moveProject(projectOrder.value, key, delta));
}

/** The project being dragged, or null. Drag state is never persisted. */
const dragging = ref<string | null>(null);

function commitOrder(next: string[]): void {
  if (next === projectOrder.value) return;
  projectOrder.value = next;
  void shared?.set(PROJECT_ORDER_KEY, next).catch(() => undefined);
}

/**
 * Reorder by dragging the handle, on pointer events.
 *
 * Not HTML5 drag-and-drop. The webview this runs in gives OS-level drag to the
 * host window, and an in-page `dragstart` is not reliably delivered — a handle
 * that works everywhere except inside the app it was written for is worse than
 * no handle at all. Pointer events are ordinary input and cannot be intercepted
 * that way.
 *
 * The list reorders under the pointer rather than at the end: a drop that only
 * shows its result once the button is released is a guess until it is too late
 * to correct.
 */
function startReorder(key: string, event: PointerEvent): void {
  if (event.button !== 0) return;
  event.preventDefault();
  const handle = event.currentTarget as HTMLElement;
  handle.setPointerCapture(event.pointerId);
  dragging.value = key;

  const move = (moved: PointerEvent) => {
    // Hit-testing rather than arithmetic on row heights: rows are two different
    // heights and change height as they fold, so the only honest answer to
    // "which row is under the pointer" is to ask.
    const under = document
      .elementFromPoint(moved.clientX, moved.clientY)
      ?.closest<HTMLElement>("[data-project-key]");
    const target = under?.dataset.projectKey;
    if (!target || target === key) return;
    commitOrder(dropProject(projectOrder.value, key, target));
  };
  const end = () => {
    dragging.value = null;
    handle.releasePointerCapture(event.pointerId);
    handle.removeEventListener("pointermove", move);
    handle.removeEventListener("pointerup", end);
    handle.removeEventListener("pointercancel", end);
  };
  handle.addEventListener("pointermove", move);
  handle.addEventListener("pointerup", end);
  handle.addEventListener("pointercancel", end);
}

/** Projects whose conversations are showing. */
const expandedRows = ref<string[]>([]);

/**
 * A clock the row labels can read.
 *
 * "2 min ago" that was rendered once and never again becomes a lie within the
 * minute. One coarse tick keeps every row honest without redrawing anything
 * between them — the labels round to minutes, so a faster clock would change
 * nothing on screen.
 */
const nowTick = ref(Date.now());
const nowTimer = setInterval(() => (nowTick.value = Date.now()), 30_000);
onUnmounted(() => clearInterval(nowTimer));

function describeProjectStatus(row: ProjectRow): string {
  return describeProjectStatusAt(row, nowTick.value);
}

/** The row the conversation on screen belongs to. */
function isActiveRow(row: ProjectRow): boolean {
  if (row.packageId && row.packageId === session.value.packageId) return true;
  return row.conversationIds.includes(session.value.id);
}

/** Whether the conversation on screen has a row of its own, unfolded under this project. */
function showsActiveConversation(row: ProjectRow): boolean {
  return isExpanded(row) && row.conversationIds.includes(session.value.id);
}

function conversationHeaderFor(id: string): ConversationHeader | undefined {
  if (activeHeader.value?.id === id) return activeHeader.value;
  return headers.value.find((header) => header.id === id);
}

function conversationTitleFor(id: string): string {
  return conversationLabel(conversationHeaderFor(id));
}

function conversationAgeFor(id: string): string {
  return describeAge(conversationHeaderFor(id)?.updatedAt ?? null, nowTick.value);
}

function toggleRowHistory(row: ProjectRow): void {
  expandedRows.value = expandedRows.value.includes(row.key)
    ? expandedRows.value.filter((key) => key !== row.key)
    : [...expandedRows.value, row.key];
}

const isExpanded = (row: ProjectRow) => expandedRows.value.includes(row.key);

/**
 * What × does on this row, stated before it is pressed.
 *
 * One control with three meanings, because the row has three things it could
 * be: a widget on the desk, a draft that was never kept, or a conversation
 * about neither. Three separate buttons would put two disabled ones on every
 * row; a button that does not say which of the three it is doing is worse than
 * either.
 */
function rowDeleteTip(row: ProjectRow): string {
  if (row.saved) return "Delete this widget and what it was granted";
  if (row.draft) return "Discard this draft";
  return "Delete this conversation";
}

async function deleteRow(row: ProjectRow): Promise<void> {
  // A conversation is a transcript and nothing else — deleting one takes away
  // no widget and no work on disk, so it does not need arming. The other two do.
  if (!row.saved && !row.draft) {
    await deleteConversation(row.conversationIds[0] ?? "");
    return;
  }
  if (pendingDelete.value !== row.key) {
    pendingDelete.value = row.key;
    return;
  }
  pendingDelete.value = null;
  if (row.saved) {
    await deleteWidget(row.packageId);
    return;
  }
  await discardDraftById(row.packageId);
}
const busy = ref(false);
const sharing = ref(false);
const shareFeedback = ref("");
watch(() => session.value.id, () => {
  sharing.value = false;
  shareFeedback.value = "";
});
const firstVersionGeneration = ref(false);
const draftWritePending = ref(0);
const draftConflict = ref<DraftConflict | null>(null);
const previewNonce = ref(0);
const pointAndPromptEnabled = import.meta.env.DEV;
const pickingElement = ref(false);
const selectedElements = ref<PreviewSelection[]>([]);
let composerCaret: Range | null = null;

function clearPreviewSelection() {
  pickingElement.value = false;
  selectedElements.value = [];
  composerCaret = null;
  composerEl.value?.querySelectorAll("[data-preview-id]").forEach((chip) => chip.remove());
}

function selectPreviewElement(element: WizardPreviewElement) {
  if (!canPickElement.value || !pickingElement.value) return;
  const root = composerEl.value;
  if (!root || selectedElements.value.some((selection) => selection.element.selector === element.selector)) return;
  closeIntegrationMenu();
  middleTab.value = "chat";
  const range = composerCaret && root.contains(composerCaret.endContainer)
    ? composerCaret.cloneRange() : document.createRange();
  if (!composerCaret || !root.contains(composerCaret.endContainer)) range.selectNodeContents(root);
  range.collapse(false);
  const selection: PreviewSelection = { id: crypto.randomUUID(), offset: 0, element };
  selectedElements.value.push(selection);
  const chip = createPreviewMention(selection);
  range.insertNode(chip);
  range.setStartAfter(chip);
  range.collapse(true);
  composerCaret = range;
  syncComposerDraft();
  void nextTick(focusComposerCaret);
}

function rememberComposerCaret() {
  const selection = window.getSelection();
  const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
  if (!range || !composerEl.value?.contains(range.endContainer)) return;
  composerCaret = range.cloneRange();
  const container = range.endContainer instanceof Element ? range.endContainer : range.endContainer.parentElement;
  const mention = container?.closest("[data-preview-id], [data-integration-id]");
  if (mention) composerCaret.setEndAfter(mention);
  composerCaret.collapse(false);
}

function focusComposerCaret() {
  const root = composerEl.value;
  if (!root) return;
  root.focus();
  if (composerCaret && root.contains(composerCaret.endContainer)) {
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(composerCaret);
  }
  resizeComposer();
}

function finishPreviewPick() {
  if (!pickingElement.value) return;
  pickingElement.value = false;
  void nextTick(focusComposerCaret);
}

function cancelPreviewPick(event: KeyboardEvent) {
  if (event.key !== "Escape" || !pickingElement.value) return;
  event.preventDefault();
  event.stopPropagation();
  finishPreviewPick();
}
onMounted(() => {
  if (pointAndPromptEnabled) window.addEventListener("keydown", cancelPreviewPick, true);
});
onUnmounted(() => window.removeEventListener("keydown", cancelPreviewPick, true));
let stopDraftEvents: (() => void) | null = null;
let stopDraftPresenceEvents: (() => void) | null = null;
let presenceTimer: ReturnType<typeof setInterval> | null = null;
let draftEventsDisposed = false;

onUnmounted(() => {
  draftEventsDisposed = true;
  stopDraftEvents?.();
  stopDraftEvents = null;
  stopDraftPresenceEvents?.();
  stopDraftPresenceEvents = null;
  if (presenceTimer) clearInterval(presenceTimer);
  presenceTimer = null;
});
const transcriptEl = ref<HTMLElement | null>(null);
const previewDebugTarget = ref<HTMLElement | null>(null);
const fileInputEl = ref<HTMLInputElement | null>(null);
const composerEl = ref<HTMLDivElement | null>(null);
const starterPrompts = [
  { label: "Countdown", prompt: "A countdown to my next holiday with an editable date and days remaining." },
  { label: "Water tracker", prompt: "A daily water tracker with a 2 litre goal and a button to log each glass." },
  { label: "Weekly goal", prompt: "A weekly reading goal of 100 pages with a progress bar and buttons to log pages." },
  { label: "Habits", prompt: "A habit tracker for reading, exercise and sleep with daily checkboxes and streaks." },
  { label: "Focus timer", prompt: "A focus timer with 25 minute work sessions, 5 minute breaks and pause and reset buttons." },
  { label: "Checklist", prompt: "A morning checklist with editable tasks that resets each day." },
];
const accountsEl = ref<HTMLDetailsElement | null>(null);
const accountsOpen = ref(false);
const integrationMenuEl = ref<HTMLElement | null>(null);
const integrationMenuOpen = ref(false);
const integrationQuery = ref("");
const integrationMenuIndex = ref(0);
const integrationTrigger = ref<{ start: number; end: number } | null>(null);
const integrationMenuStyle = ref<Record<string, string>>({});

const filteredIntegrationOptions = computed(() => {
  const query = integrationQuery.value.trim().toLocaleLowerCase();
  if (!query) return providerOptions.value;
  return providerOptions.value.filter((option) => option.label.toLocaleLowerCase().includes(query));
});
type IntegrationOption = (typeof providerOptions.value)[number];

function closeIntegrationMenu(): void {
  integrationMenuOpen.value = false;
  integrationQuery.value = "";
  integrationTrigger.value = null;
}

/** The editor's plain-text value, including line breaks and mention labels. */
function composerText(onElement?: (id: string, offset: number) => void): string {
  const root = composerEl.value;
  if (!root) return "";
  const parts: string[] = [];
  let lastElementOffset = 0;

  const visit = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push(node.textContent ?? "");
      return;
    }
    if (node instanceof HTMLElement && node.dataset.previewId) {
      lastElementOffset = parts.join("").length;
      onElement?.(node.dataset.previewId, lastElementOffset);
      return;
    }
    if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).dataset.integrationId) {
      const label = (
        (node as HTMLElement).dataset.integrationLabel ?? (node.textContent ?? "")
      ).replace(/^@/, "");
      parts.push(`@${label}`);
      return;
    }
    if (node.nodeName === "BR") {
      parts.push("\n");
      return;
    }
    const block = node !== root && (node.nodeName === "DIV" || node.nodeName === "P");
    if (block && parts.length > 0 && !parts[parts.length - 1]?.endsWith("\n")) parts.push("\n");
    node.childNodes.forEach(visit);
    if (block && !parts[parts.length - 1]?.endsWith("\n")) parts.push("\n");
  };

  visit(root);
  const text = parts.join("");
  // A line break before an inline element is content, even with no text after it.
  return text.slice(0, Math.max(text.replace(/\n+$/, "").length, lastElementOffset));
}

function nodeTextLength(node: Node): number {
  if (node instanceof HTMLElement && node.dataset.previewId) return 0;
  if (node.nodeType === Node.TEXT_NODE) return node.textContent?.length ?? 0;
  if (node.nodeName === "BR") return 1;
  if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).dataset.integrationId) {
    // Mentions display only their label but serialize as `@Label` in the draft.
    const label = (
      (node as HTMLElement).dataset.integrationLabel ?? (node.textContent ?? "")
    ).replace(/^@/, "");
    return label.length + 1;
  }
  let length = 0;
  node.childNodes.forEach((child) => {
    length += nodeTextLength(child);
  });
  return length;
}

/** Convert a DOM selection point into the same offsets used by `session.draft`. */
function composerOffset(node: Node, offset: number): number | null {
  const root = composerEl.value;
  if (!root || (node !== root && !root.contains(node))) return null;

  const measure = (current: Node): number | null => {
    if (current === node) {
      if (current.nodeType === Node.TEXT_NODE) return Math.min(offset, current.textContent?.length ?? 0);
      if (current.nodeType === Node.ELEMENT_NODE && (current as HTMLElement).dataset.integrationId) {
        return offset > 0 ? nodeTextLength(current) : 0;
      }
      return Array.from(current.childNodes)
        .slice(0, offset)
        .reduce((total, child) => total + nodeTextLength(child), 0);
    }
    let before = 0;
    for (const child of Array.from(current.childNodes)) {
      const found = measure(child);
      if (found !== null) return before + found;
      before += nodeTextLength(child);
    }
    return null;
  };

  return measure(root);
}

function textOffsetRange(start: number, end: number): Range | null {
  const root = composerEl.value;
  if (!root) return null;

  // `composerText` gives mentions a synthetic leading `@`, while that
  // character does not exist in the DOM. Walk the tree with the same logical
  // lengths so a trigger after an earlier mention still maps to real text.
  let position = 0;
  let startPoint: { node: Node; offset: number } | null = null;
  let endPoint: { node: Node; offset: number } | null = null;

  const visit = (node: Node): void => {
    if (endPoint) return;
    if (node instanceof HTMLElement && node.dataset.previewId) return;
    if (node.nodeType === Node.TEXT_NODE) {
      const length = node.textContent?.length ?? 0;
      if (!startPoint && start >= position && start <= position + length) {
        startPoint = { node, offset: start - position };
      }
      if (!endPoint && end >= position && end <= position + length) {
        endPoint = { node, offset: end - position };
      }
      position += length;
      return;
    }
    if (node.nodeName === "BR") {
      position += 1;
      return;
    }
    if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).dataset.integrationId) {
      position += nodeTextLength(node);
      return;
    }
    node.childNodes.forEach(visit);
  };

  visit(root);

  const from = startPoint as { node: Node; offset: number } | null;
  const to = endPoint as { node: Node; offset: number } | null;
  if (!from || !to) return null;
  const range = document.createRange();
  range.setStart(from.node, from.offset);
  range.setEnd(to.node, to.offset);
  return range;
}

function createIntegrationMention(option: { id: string; label: string }): HTMLSpanElement {
  const mention = document.createElement("span");
  mention.className = "wiz-inline-mention";
  mention.dataset.integrationId = option.id;
  mention.dataset.integrationLabel = option.label;
  mention.contentEditable = "false";
  mention.setAttribute("role", "button");
  mention.setAttribute("aria-label", `Integration ${option.label}`);

  const mark = document.createElement("span");
  mark.className = "wiz-inline-mention-mark";
  const label = document.createElement("span");
  label.textContent = option.label.replace(/^@/, "");
  mention.append(mark, label);
  render(h(BrandMark, { provider: option.id, size: 14 }), mark);
  return mention;
}

function createPreviewMention(selection: PreviewSelection): HTMLSpanElement {
  const chip = document.createElement("span");
  chip.className = "wiz-inline-element";
  chip.dataset.previewId = selection.id;
  chip.contentEditable = "false";
  chip.title = [selection.element.selector, selection.element.text].filter(Boolean).join("\n");
  const label = document.createElement("span");
  label.className = "wiz-inline-element__label";
  label.textContent = selection.element.selector.split(" > ").pop() ?? selection.element.tag;
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "wiz-inline-element__remove";
  // Drawn, not the "×" glyph: the glyph sits on the text baseline, below centre.
  const cross = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  cross.setAttribute("viewBox", "0 0 24 24");
  cross.setAttribute("aria-hidden", "true");
  cross.innerHTML = '<path d="M18 6 6 18M6 6l12 12"/>';
  remove.append(cross);
  remove.setAttribute("aria-label", `Remove selected element ${selection.element.selector}`);
  remove.addEventListener("mousedown", (event) => event.preventDefault());
  remove.addEventListener("click", (event) => {
    event.stopPropagation();
    if (busy.value) return;
    const range = document.createRange();
    range.setStartBefore(chip);
    range.collapse(true);
    chip.remove();
    composerCaret = range;
    syncComposerDraft();
    focusComposerCaret();
  });
  chip.append(label, remove);
  return chip;
}

function renderComposer(): void {
  const root = composerEl.value;
  if (!root) return;

  root.querySelectorAll<HTMLElement>(".wiz-inline-mention-mark").forEach((mark) => render(null, mark));
  root.replaceChildren();
  composerCaret = null;
  for (const part of pointAndPromptParts(session.value.draft, selectedElements.value)) {
    if (part.kind === "element") {
      root.append(createPreviewMention(part.selection));
      continue;
    }
    for (const mention of splitProviderMentions(part.text, providerOptions.value)) {
      root.append(mention.kind === "text" ? document.createTextNode(mention.text) : createIntegrationMention(mention));
    }
  }
}

/** Fill an editable starting point and leave sending to the user. */
function chooseStarter(prompt: string): void {
  if (busy.value) return;
  session.value.draft = prompt;
  closeIntegrationMenu();
  renderComposer();
  const root = composerEl.value;
  if (!root) return;
  root.focus();
  const range = document.createRange();
  range.selectNodeContents(root);
  range.collapse(false);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  resizeComposer();
}

/** Insert a next step for editing; generation still requires the Send button. */
function chooseSuggestion(suggestion: WizardSuggestion): void {
  if (busy.value) return;
  chooseStarter(appendWizardSuggestion(session.value.draft, suggestion.prompt));
}

/** Preserve preview references while rendering provider mentions in the surrounding text. */
function mentionSegments(bubble: WizardBubble): (MentionSegment | PreviewTranscriptPart)[] {
  const parts: PreviewTranscriptPart[] = bubble.role === "user"
    ? splitPreviewTranscript(bubble.text, bubble.elementReferences) : [{ kind: "text", text: bubble.text }];
  return parts.flatMap<MentionSegment | PreviewTranscriptPart>((part) => part.kind === "text"
    ? splitProviderMentions(part.text, providerOptions.value) : [part]);
}

function syncComposerDraft(): void {
  const remaining: PreviewSelection[] = [];
  const text = composerText((id, offset) => {
    const selection = selectedElements.value.find((entry) => entry.id === id);
    if (selection) remaining.push({ ...selection, offset });
  });
  selectedElements.value = remaining;
  if (text !== session.value.draft) session.value.draft = text;
}

/**
 * Put the menu under the caret — or above it, when under does not fit.
 *
 * The clamp used to be the only answer to "it would hang off the bottom": pull
 * it up until it fits, which lands it on top of the composer and hides the
 * word being typed. Rare with the card near the middle of a screen, and the
 * normal case as soon as the composer sits low — the Wizard dragged to the
 * bottom edge, or the card embedded in a page that scrolls.
 *
 * Flipping is what a menu is supposed to do there, and it needs the menu's own
 * measurements rather than the 268/228 that were hard-coded beside a menu free
 * to change size. It is already rendered when this runs (`nextTick`), so they
 * can simply be read.
 */
function positionIntegrationMenu(): void {
  const root = composerEl.value;
  const menu = integrationMenuEl.value;
  if (!root || !menu) return;
  const selection = window.getSelection();
  const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  const caret = range?.getBoundingClientRect();
  const editor = root.getBoundingClientRect();
  const width = menu.offsetWidth || 268;
  const height = menu.offsetHeight || 220;
  const GAP = 6;
  const EDGE = 8;

  const left = caret?.left || editor.left;
  const below = (caret?.bottom || editor.top + 24) + GAP;
  const above = (caret?.top || editor.top) - GAP - height;
  // Below unless it would run off the bottom and there is room above.
  const fitsBelow = below + height <= window.innerHeight - EDGE;
  const top = fitsBelow || above < EDGE ? below : above;

  integrationMenuStyle.value = {
    left: `${Math.min(Math.max(EDGE, left), Math.max(EDGE, window.innerWidth - width - EDGE))}px`,
    top: `${Math.min(Math.max(EDGE, top), Math.max(EDGE, window.innerHeight - height - EDGE))}px`,
  };
}

function updateIntegrationMenu(): void {
  const root = composerEl.value;
  const selection = window.getSelection();
  if (!root || !selection || selection.rangeCount === 0 || !selection.isCollapsed) {
    closeIntegrationMenu();
    return;
  }
  const range = selection.getRangeAt(0);
  const end = composerOffset(range.endContainer, range.endOffset);
  if (end === null) {
    closeIntegrationMenu();
    return;
  }
  const before = composerText().slice(0, end);
  const match = before.match(/(?:^|\s)@([^\s@]*)$/);
  if (!match) {
    closeIntegrationMenu();
    return;
  }
  const start = end - match[1]!.length - 1;
  integrationTrigger.value = { start, end };
  integrationQuery.value = match[1]!;
  integrationMenuIndex.value = Math.min(integrationMenuIndex.value, Math.max(0, filteredIntegrationOptions.value.length - 1));
  integrationMenuOpen.value = filteredIntegrationOptions.value.length > 0;
  void nextTick(positionIntegrationMenu);
}

function chooseIntegration(option: IntegrationOption): void {
  const trigger = integrationTrigger.value;
  if (!trigger) return;
  const range = textOffsetRange(trigger.start, trigger.end);
  if (!range) return;

  range.deleteContents();
  const mention = createIntegrationMention(option);
  range.insertNode(mention);
  const spacer = document.createTextNode(" ");
  range.setStartAfter(mention);
  range.collapse(true);
  range.insertNode(spacer);
  range.setStartAfter(spacer);
  range.collapse(true);

  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  toggleProvider(option.id, true);
  syncComposerDraft();
  closeIntegrationMenu();
  composerEl.value?.focus();
  void nextTick(resizeComposer);
}

function onComposerInput(): void {
  syncComposerDraft();
  rememberComposerCaret();
  updateIntegrationMenu();
  resizeComposer();
}

function onComposerKeydown(event: KeyboardEvent): void {
  if (event.target instanceof HTMLElement && event.target.closest(".wiz-inline-element__remove")) return;
  // Enter can confirm an IME candidate; WebKit may only report keyCode 229.
  if (event.isComposing || event.keyCode === 229) return;
  if (integrationMenuOpen.value) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      const length = filteredIntegrationOptions.value.length;
      integrationMenuIndex.value = (integrationMenuIndex.value + direction + length) % length;
      return;
    }
    if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") {
      event.preventDefault();
      const option = filteredIntegrationOptions.value[integrationMenuIndex.value];
      if (option) chooseIntegration(option);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeIntegrationMenu();
      return;
    }
  }
  if (event.key === "Enter") {
    event.preventDefault();
    event.stopPropagation();
    if (event.shiftKey) {
      document.execCommand("insertLineBreak");
      syncComposerDraft();
      updateIntegrationMenu();
      return;
    }
    syncComposerDraft();
    void send();
  }
}

function onComposerPaste(event: ClipboardEvent): void {
  const files = Array.from(event.clipboardData?.items ?? [])
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);
  if (files.length > 0) {
    event.preventDefault();
    void attach(files);
    return;
  }
  const text = event.clipboardData?.getData("text/plain");
  if (!text) return;
  event.preventDefault();
  document.execCommand("insertText", false, text);
  syncComposerDraft();
  updateIntegrationMenu();
}

function closeIntegrationMenuOnOutsidePointer(event: PointerEvent): void {
  if (!integrationMenuEl.value?.contains(event.target as Node)) closeIntegrationMenu();
}

onMounted(() => {
  window.addEventListener("pointerdown", closeIntegrationMenuOnOutsidePointer, true);
});

onUnmounted(() => {
  window.removeEventListener("pointerdown", closeIntegrationMenuOnOutsidePointer, true);
});

function closeAccountsOnOutsidePointer(event: PointerEvent) {
  const details = accountsEl.value;
  if (details && !details.contains(event.target as Node)) {
    details.open = false;
    accountsOpen.value = false;
  }
}

onMounted(() => {
  window.addEventListener("pointerdown", closeAccountsOnOutsidePointer, true);
});

onUnmounted(() => {
  window.removeEventListener("pointerdown", closeAccountsOnOutsidePointer, true);
});

/**
 * Bumped to abandon a reply in flight.
 *
 * The request itself keeps running at the provider — there is no way to recall
 * it from here, and you are billed for it either way. What Stop buys is the
 * conversation: the answer is discarded instead of landing on top of whatever
 * you did next.
 */
const generation = ref(0);
/** Widget awaiting a second click to confirm deletion. */
const pendingDelete = ref<string | null>(null);

/** Open state of the attach menu. */
const attachMenuOpen = ref(false);
const plusEl = ref<HTMLElement | null>(null);

function closeAttachMenuOnOutsidePointer(event: PointerEvent) {
  const plus = plusEl.value;
  if (plus && !plus.contains(event.target as Node)) attachMenuOpen.value = false;
}

onMounted(() => {
  window.addEventListener("pointerdown", closeAttachMenuOnOutsidePointer, true);
});

onUnmounted(() => {
  window.removeEventListener("pointerdown", closeAttachMenuOnOutsidePointer, true);
});

/**
 * Which face the middle column is showing.
 *
 * The tabs used to sit over the preview, so reading a file meant covering the
 * widget — and those two are looked at together: you change a line and watch
 * what it does. The preview is its own column now and never moves; what
 * switches is the conversation against the files.
 */
const middleTab = ref<"chat" | "files" | "api">("chat");
/** Which file the editor is showing, by path. */
const openFile = ref<string>("manifest.json");
/** Editable copy of that file; applied when the field loses focus. */
const fileText = ref("");

const fileList = computed(() =>
  [...(session.value.draftFiles ?? [])].sort((a, b) => a.path.localeCompare(b.path)),
);

const fileRows = computed(() => fileTreeRows(fileList.value.map((file) => file.path)));

/** Each kind of file gets its icon and, through its class, its colour. */
const FILE_ICONS: Record<FileKind, Component> = {
  json: BracesIcon,
  markup: CodeXmlIcon,
  script: FileCodeIcon,
  style: HashIcon,
  image: ImageIcon,
  text: FileIcon,
};

/** The open file's folders, for the path above the editor. */
const openFileFolders = computed(() => openFile.value.split("/").slice(0, -1));
const openFileName = computed(() => openFile.value.slice(openFile.value.lastIndexOf("/") + 1));

/** A textarea can be dirty even when the in-memory file set is unchanged. */
const draftEditorDirty = computed(() => {
  const current = session.value.draftFiles?.find((file) => file.path === openFile.value);
  return current !== undefined && current.contents !== fileText.value;
});

/**
 * The coloured copy of what the textarea holds.
 *
 * Rendered as `v-for`'d spans rather than as `v-html`, so the text never
 * becomes markup: the content here is model output being edited by hand, and
 * "escape it correctly" is a thing to get wrong once. Vue writes text nodes,
 * which cannot be anything but text.
 */
const codeTokens = computed<CodeToken[]>(() => {
  const language = highlightLanguage(openFile.value);
  return language ? tokenize(fileText.value, language) : [{ kind: "plain", text: fileText.value }];
});

/**
 * The endpoints of the package in hand, and one response per endpoint.
 *
 * WHY THIS TAB EXISTS. Building a widget against an API used to be: describe
 * the API, get a widget, run it, watch it render "undefined", go looking for
 * the real field names, say them out loud, repeat. The model was guessing the
 * response shape, because guessing was the only thing available to it. One
 * request removes the guess — and the same request tells the person whether
 * their endpoint is right at all, which used to take a Save, an approval and a
 * reload to find out.
 */
const endpointProbes = computed(() => endpointsToProbe(session.value.draftFiles ?? []));

/**
 * The providers the package reads from, for the API tab.
 *
 * A widget on a provider calls no API of its own: Kavibay makes the requests
 * and the widget asks for queries by name. Without these the tab stayed away
 * from exactly the widgets that talk to an API the most, and a weather widget
 * showed no sign of where its weather came from.
 */
const usedProviders = computed(() =>
  providersUsedBy(session.value.draftFiles ?? [], providerSchemas.value).map((use) => ({
    ...use,
    state: providerUseState(use, providerConnected.value.get(use.id) === true),
  })),
);

/** What the package's code calls, so the tab can say which of the catalog it uses. */
const providerCalls = computed(() => providerCallsIn(session.value.draftFiles ?? []));

const PROVIDER_STATE_LABEL: Record<ProviderUseState, string> = {
  missing: "Not available",
  free: "No account needed",
  connected: "Connected",
  disconnected: "Not connected",
};

type MiddleTab = typeof middleTab.value;

/**
 * The switch above the middle column, one entry per face.
 *
 * API is only listed when there is something to show: an endpoint the package
 * declares or a provider it reads from. A tab that is always there
 * and usually empty teaches people to stop looking at it.
 */
const middleTabs = computed(() => [
  { id: "chat" as MiddleTab, label: "Chat", icon: MessageSquareIcon, count: 0, disabled: false },
  {
    id: "files" as MiddleTab,
    label: "Code",
    icon: CodeXmlIcon,
    count: fileList.value.length,
    disabled: !fileList.value.length,
  },
  ...(endpointProbes.value.length + usedProviders.value.length
    ? [
        {
          id: "api" as MiddleTab,
          label: "API",
          icon: PlugIcon,
          count: endpointProbes.value.length + usedProviders.value.length,
          disabled: false,
        },
      ]
    : []),
]);

/** Arrow keys walk the switch the way they walk any tab list. */
function stepMiddleTab(delta: -1 | 1): void {
  const open = middleTabs.value.filter((tab) => !tab.disabled);
  const at = open.findIndex((tab) => tab.id === middleTab.value);
  const next = open[(at + delta + open.length) % open.length];
  if (!next) return;
  middleTab.value = next.id;
  void nextTick(() => wizEl.value?.querySelector<HTMLElement>(".wiz-tab--on")?.focus());
}

/**
 * What the host's endpoint broker answers with.
 *
 * Declared here rather than imported: the definition lives in GPL host code and
 * this extension is MIT. Only the fields this tab reads are named, and the
 * broker never rejects — every failure arrives as `ok: false` with a code.
 */
interface EndpointCallResult {
  ok: boolean;
  status: number | null;
  data: unknown;
  code: string | null;
  detail: string | null;
}

/** What is typed into the argument boxes, per endpoint and name. */
const probeArgs = ref<Record<string, Record<string, string>>>({});
/** Which endpoint is in flight, so only its own button says so. */
const probing = ref<string>("");
/** A refusal that never became a response — shown instead of one. */
const probeErrors = ref<Record<string, string>>({});

const sampleFor = (endpointId: string) =>
  (session.value.samples ?? []).find((sample) => sample.endpointId === endpointId);

/**
 * Call one endpoint and keep what it said.
 *
 * Every value is sent as text, exactly as typed. Rust holds the declaration and
 * coerces and validates against it — a second interpretation here could only
 * disagree with the one that counts, and the disagreement would show up as a
 * widget that works in this tab and not in the frame.
 */
async function probeEndpoint(probe: EndpointProbe) {
  const extId = previewExtId.value;
  if (!extId || probing.value) return;

  probing.value = probe.id;
  delete probeErrors.value[probe.id];
  try {
    const args: Record<string, string> = {};
    for (const [name, value] of Object.entries(probeArgs.value[probe.id] ?? {})) {
      if (value !== "") args[name] = value;
    }
    const result = await wizard.endpointCall<EndpointCallResult>(extId, probe.id, args);

    if (!result.ok) {
      // The host's own code and detail, unedited. `unknown_endpoint` means the
      // id is wrong, `invalid_declaration` that api.json does not parse,
      // `credential_not_granted` that this one needs an account the draft
      // cannot hold — three different fixes that a single "it failed" hides.
      probeErrors.value[probe.id] = result.detail
        ? `${result.code ?? "failed"} — ${result.detail}`
        : (result.code ?? "The call failed.");
      return;
    }

    const kept: EndpointSample = {
      endpointId: probe.id,
      status: result.status,
      body: sampleBody(result.data),
    };
    const samples = (session.value.samples ?? []).filter((one) => one.endpointId !== probe.id);
    session.value.samples = [...samples, kept];
    await save(session.value);
  } catch (error) {
    probeErrors.value[probe.id] = String(error);
  } finally {
    probing.value = "";
  }
}

/**
 * One typed argument, read and written by name.
 *
 * A pair of accessors rather than a `v-model` into `(probeArgs[id] ??= {})[…]`:
 * that expression created the per-endpoint record as a side effect of
 * rendering, which worked but put a mutation inside a template binding.
 */
const probeArg = (endpointId: string, name: string) =>
  probeArgs.value[endpointId]?.[name] ?? "";

function setProbeArg(endpointId: string, name: string, value: string) {
  const current = probeArgs.value[endpointId] ?? {};
  probeArgs.value = { ...probeArgs.value, [endpointId]: { ...current, [name]: value } };
}

/** An enum's values as rows, with an empty first one for "not set". */
const enumOptions = (values: readonly string[]) => [
  { value: "", label: "—" },
  ...values.map((one) => ({ value: one, label: one })),
];

/** Drop a captured response, so it is neither shown nor sent. */
async function dropSample(endpointId: string) {
  session.value.samples = (session.value.samples ?? []).filter(
    (sample) => sample.endpointId !== endpointId,
  );
  await save(session.value);
}

const inkEl = ref<HTMLElement | null>(null);
const codeEl = ref<HTMLTextAreaElement | null>(null);

/**
 * The coloured layer follows the textarea, which is the only one that scrolls.
 *
 * `overflow: hidden` on the `<pre>` rather than `auto`: it must not offer its
 * own scrollbar — two of them would disagree, and the one on top is the one
 * with the caret in it.
 */
function syncInk() {
  const source = codeEl.value;
  const ink = inkEl.value;
  if (!source || !ink) return;
  ink.scrollTop = source.scrollTop;
  ink.scrollLeft = source.scrollLeft;
}

/** A different file starts at the top, in both layers at once. */
watch(openFile, async () => {
  await nextTick();
  if (codeEl.value) {
    codeEl.value.scrollTop = 0;
    codeEl.value.scrollLeft = 0;
  }
  syncInk();
});

/**
 * Reload the editor whenever the package underneath changes.
 *
 * Tracked by path rather than by position: the model returns the whole set
 * every turn and is free to reorder it, and an editor keyed on the index would
 * quietly start showing a different file mid-conversation.
 */
watch(
  [() => session.value.draftFiles, openFile],
  () => {
    const files = session.value.draftFiles ?? [];
    if (files.length > 0 && !files.some((file) => file.path === openFile.value)) {
      openFile.value = files.find((f) => f.path === "manifest.json")?.path ?? files[0]!.path;
    }
    fileText.value = files.find((file) => file.path === openFile.value)?.contents ?? "";
  },
  { immediate: true },
);

/**
 * True when editing this file invalidates the consent already given.
 *
 * `api.json` is hashed at enable time, so any edit makes the stored grant stale
 * and the endpoints have to be reviewed again. That is correct, and worth
 * saying *here*: the alternative is meeting it later as a `consent_stale` code
 * in the debug panel, which names the symptom and not the edit that caused it.
 */
const editInvalidatesConsent = computed(() => openFile.value === "api.json");

/**
 * Resolve the optimistic-write token used by the shared draft service.
 * Sessions stored before revisions existed acquire one through the full-text
 * read command; a missing draft is the only valid reason to send `null`.
 */
async function expectedDraftRevision(id: string): Promise<string | null> {
  if (session.value.draftRevision) return session.value.draftRevision;
  try {
    const snapshot = await wizard.draftRead<DraftSnapshot>(id);
    /**
     * A draft this conversation has never held belongs to somebody else.
     *
     * Adopting its revision unconditionally is what made the optimistic check
     * useless in exactly the case it exists for: a new conversation that lands
     * on a name an MCP client is already using reads that draft, finds a
     * revision that validates, and publishes over it. The check is `hasDraft`
     * and not the revision, because a session stored before revisions existed
     * legitimately has the first without the second.
     */
    if (!session.value.hasDraft) throw new Error(`draft_exists:${id}`);
    session.value.draftRevision = snapshot.revision;
    return snapshot.revision;
  } catch (error) {
    if (String(error).includes("draft_not_found")) return null;
    throw error;
  }
}

async function writeDraftFiles(
  id: string,
  files: GeneratedFile[],
  expectedRevisionOverride?: string | null,
): Promise<DraftSummary> {
  draftWritePending.value += 1;
  try {
    const expectedRevision =
      expectedRevisionOverride === undefined
        ? await expectedDraftRevision(id)
        : expectedRevisionOverride;
    const summary = await wizard.draftWrite<DraftSummary>(id, files, expectedRevision);
    session.value.draftRevision = summary.revision;
    session.value.draftError = summary.error ?? undefined;
    // The manifest names the package, so a write can answer about a different
    // folder than the one it was sent to. Following it here is what makes
    // renaming work from *any* path — the chat, the file editor, a model that
    // decided on a better name — rather than only from the name field.
    if (summary.renamedFrom) followRename(summary.id);
    return summary;
  } finally {
    draftWritePending.value = Math.max(0, draftWritePending.value - 1);
  }
}

/**
 * Point this conversation at the folder the package now lives in.
 *
 * `editing` deliberately does not move. It names the widget that is *installed*
 * right now, which is still sitting on the desk under its old name, and Save
 * needs it to retire that copy instead of leaving a second one behind.
 */
function followRename(next: string, message?: string): void {
  const previous = session.value.packageId;
  if (!next || previous === next) return;
  session.value.packageId = next;
  // The preview frame runs under the package id, so the old url is a folder
  // that no longer exists.
  previewNonce.value += 1;
  note(message ?? `Renamed to "${next}".`);
  void save(session.value);
}

/** Read the current snapshot after an identity-only event; never trust event bodies. */
async function readDraftSnapshot(id: string): Promise<DraftSnapshot | null> {
  try {
    return await wizard.draftRead<DraftSnapshot>(id);
  } catch (error) {
    if (String(error).includes("draft_not_found")) return null;
    return null;
  }
}

/** Refresh only the draft list. This never changes the chat. */
async function refreshDrafts(): Promise<void> {
  try {
    const rows = await wizard.drafts<DraftSummary[]>();
    drafts.value = Array.isArray(rows) ? rows : [];
  } catch {
    drafts.value = [];
  }
}

/**
 * Recover an MCP change that happened while this card was closed.
 *
 * Live events keep an open card current, but they cannot be replayed after an
 * app restart. The draft list is the durable signal; when its revision is newer
 * than the stored conversation, read the same snapshot the event handler would
 * have applied instead of leaving the conversation on its old saved files.
 */
async function reconcileActiveDraftFromList(): Promise<void> {
  const id = session.value.packageId;
  if (!id) return;
  const summary = drafts.value.find((draft) => draft.id === id);
  if (!summary || summary.revision === session.value.draftRevision) return;

  const event: DraftSyncEvent = {
    id,
    revision: summary.revision,
    kind: "written",
    origin: summary.lastWriter === "wizard" ? "wizard" : "mcp",
    client: summary.lastClient,
    clientName: summary.lastClientName,
  };
  const decision = draftSyncDecision(event, {
    activeId: id,
    activeRevision: session.value.draftRevision,
    busy: busy.value || draftWritePending.value > 0,
    editorDirty: draftEditorDirty.value,
  });
  if (decision === "ignore" || decision === "other") return;

  const snapshot = await readDraftSnapshot(id);
  if (!snapshot) return;
  if (decision === "apply") {
    await applyExternalSnapshot(snapshot);
    return;
  }
  setQueuedConflict(snapshot, draftEditorDirty.value ? "dirty" : "external");
}

function draftDisplayName(id: string, files: GeneratedFile[]): string {
  const manifest = files.find((file) => file.path === "manifest.json");
  if (!manifest) return id;
  try {
    const parsed = JSON.parse(manifest.contents) as { displayName?: unknown; name?: unknown };
    if (typeof parsed.displayName === "string" && parsed.displayName.trim()) {
      return parsed.displayName.trim();
    }
    if (typeof parsed.name === "string" && parsed.name.trim()) return parsed.name.trim();
  } catch {
    // The validation message is shown in the files view; the id remains a safe label here.
  }
  return id;
}

/** Apply a complete snapshot and create a visible, capped version checkpoint. */
async function applyExternalSnapshot(
  snapshot: DraftSnapshot,
  label = describeDraftUpdate(draftAuthorOf(snapshot.lastWriter ?? null, snapshot.lastClient)),
): Promise<void> {
  const author = draftAuthorOf(snapshot.lastWriter ?? null, snapshot.lastClient);
  const clientName = snapshot.lastClientName ?? null;
  const applied = applyDraftSnapshot(snapshot);
  session.value.draftFiles = applied.draftFiles;
  session.value.draftRevision = applied.draftRevision;
  session.value.knownFiles = applied.knownFiles;
  session.value.draftError = snapshot.error ?? undefined;
  session.value.hasDraft = true;
  session.value.previewEntry = uiEntryOf(applied.draftFiles);
  session.value.previewPermissions = previewPermissionsFor(applied.draftFiles);
  session.value.previewSize = manifestSize(applied.draftFiles) ?? session.value.previewSize;
  session.value.previewScale = manifestScale(applied.draftFiles) ?? session.value.previewScale;
  rememberVersion(applied.draftFiles, label, author, clientName);
  session.value.bubbles.push({
    role: "system",
    text: label,
    author,
    clientName,
    version: session.value.currentVersion,
  });
  previewNonce.value += 1;
  await save(session.value);
  scrollDown();
}

function setQueuedConflict(
  snapshot: DraftSnapshot | null,
  reason: DraftConflict["reason"],
): void {
  const localFiles = (session.value.draftFiles ?? []).map((file) =>
    file.path === openFile.value && draftEditorDirty.value
      ? { ...file, contents: fileText.value }
      : { ...file },
  );
  const next: DraftConflict = {
    id: session.value.packageId ?? "",
    external: snapshot,
    externalRevision: snapshot?.revision ?? null,
    localFiles,
    reason,
  };
  draftConflict.value = queueDraftConflict(draftConflict.value, next);
}

/** Event handler supplied by the host transport; extensions never import Tauri. */
async function handleDraftChanged(event: DraftChanged): Promise<void> {
  const context = {
    activeId: session.value.packageId,
    activeRevision: session.value.draftRevision,
    busy: busy.value || draftWritePending.value > 0,
    editorDirty: draftEditorDirty.value,
  };
  const decision = draftSyncDecision(event as DraftSyncEvent, context);
  if (decision === "other") {
    await refreshDrafts();
    return;
  }
  // A rename arrives under the new name. Retarget before anything reads the
  // draft: `event.id` is the only folder that still exists.
  if (event.renamedFrom && event.renamedFrom === session.value.packageId) {
    followRename(event.id);
  }
  if (decision === "ignore") return;

  const snapshot = event.kind === "written" ? await readDraftSnapshot(event.id) : null;
  await refreshDrafts();
  if (decision === "apply" && snapshot) {
    await applyExternalSnapshot(snapshot);
    return;
  }
  setQueuedConflict(snapshot, decision === "conflict" && draftEditorDirty.value ? "dirty" : "external");
}

/**
 * Apply a hand-edited file.
 *
 * On blur rather than on every keystroke: half-typed JSON is not a mistake, it
 * is somebody in the middle of a word. A `.json` file that does not parse is
 * reported and nothing is written — the package on disk stays the one that
 * worked. Anything else is written as typed, and a broken `widget.js` shows up
 * in the preview, which is what the preview is for.
 */
async function applyFile() {
  const files = session.value.draftFiles;
  const id = session.value.packageId;
  if (!files || !id) return;

  const current = files.find((file) => file.path === openFile.value);
  if (!current || current.contents === fileText.value) return;

  if (openFile.value.endsWith(".json")) {
    try {
      JSON.parse(fileText.value);
    } catch {
      note(`${openFile.value} is not valid JSON, so it was not applied.`);
      return;
    }
  }

  const next = files.map((file) =>
    file.path === openFile.value ? { ...file, contents: fileText.value } : file,
  );
  busy.value = true;
  try {
    await writeDraftFiles(id, next);
    session.value.draftFiles = next;
    rememberVersion(next, `Edited ${openFile.value}`);
    // A hand edit changes the widget as much as an answer does and used to
    // leave no trace here at all — so the next answer appeared to come out of
    // the previous one, which was no longer what was on disk.
    session.value.bubbles.push({
      role: "system",
      text: `Edited ${openFile.value}.`,
      version: session.value.currentVersion,
    });
    session.value.hasDraft = true;
    session.value.previewEntry = uiEntryOf(next);
    session.value.previewPermissions = previewPermissionsFor(next);
    session.value.previewSize = manifestSize(next) ?? session.value.previewSize;
    session.value.previewScale = manifestScale(next) ?? session.value.previewScale;
    previewNonce.value += 1;
    await save(session.value);
  } catch (error) {
    note(describeDraftError(String(error)));
  } finally {
    busy.value = false;
  }
}

const activeModel = computed(() =>
  models.value.find((model) => model.id === session.value.model),
);

/**
 * The platforms this build can author on, and whether any of them is connected.
 *
 * Asked before the conversation invites anybody to describe anything. Inviting
 * first and mentioning the missing key in a caption above the transcript put
 * the requirement where it reads as a footnote — somebody typed a widget
 * description, pressed send, and only then found out that the whole thing needs
 * an account somewhere else.
 */
const platforms = computed(() => wizardPlatforms(models.value));
const hasAnyKey = computed(() => wizardHasAnyKey(models.value));

/** Open Settings → AI on this platform's provider tab. */
function openPlatformSettings(platform: { id: string }): void {
  wizard.openSettings("ai", platform.id);
}

/**
 * The effort levels this model takes, or none.
 *
 * Read off the catalog rather than listed here: the two providers use different
 * words, and one model in the catalog returns an error when the parameter is
 * present at all. A picker built from a constant would offer that model a
 * choice that fails.
 */
const effortLevels = computed(() => activeModel.value?.effortLevels ?? []);



/**
 * The level actually in force — the stored one while the model still takes it.
 *
 * Not written back on a model switch, only read through: the person may switch
 * to look at a price and switch back, and their choice should survive the trip.
 * It is filtered on the way out instead, so a level the new model never heard
 * of is simply not sent.
 */
const effort = computed({
  get: () => effortForModel(session.value.effort, activeModel.value),
  set: (level: string | undefined) => {
    session.value.effort = level || undefined;
    void save(session.value);
  },
});
const canSend = computed(
  () =>
    !busy.value &&
    (session.value.draft.trim().length > 0 || session.value.attachments.length > 0),
);
const suggestions = computed(() =>
  busy.value || session.value.draftError || draftConflict.value || draftEditorDirty.value
    ? []
    : currentWizardSuggestions(session.value.bubbles, session.value.currentVersion),
);
const showFirstVersionGeneration = computed(
  () => firstVersionGeneration.value && busy.value,
);
const previewUrl = computed(() => {
  const id = session.value.packageId;
  const entry = session.value.previewEntry;
  if (!id || !entry) return null;
  const host = session.value.hasDraft ? `__draft__${id}` : id;
  return wizard.runtimeEntryUrl(host, entry);
});
const previewExtId = computed(() => {
  const id = session.value.packageId;
  if (!id) return "";
  return session.value.hasDraft ? `__draft__${id}` : id;
});
/**
 * Which frame the stage embeds the preview with.
 *
 * Split on `hasDraft` exactly as the two above are: an unsaved draft is only
 * described by the files in hand, while a saved package is described by the
 * scan — and the scan is the authority once one exists.
 */
const previewFormat = computed<"contract" | "runtime">(() => {
  if (session.value.hasDraft) {
    return isContractPackageFiles(session.value.draftFiles ?? []) ? "contract" : "runtime";
  }
  return scanned.value.find((row) => row.id === session.value.packageId)?.format ?? "runtime";
});
/**
 * Save is offered when there is something to save.
 *
 * A generation is the obvious case; resizing an existing widget is the other
 * one. Someone who drags a saved widget to a new size and finds Save greyed out
 * has been told their change does not count.
 */
const canSave = computed(
  () =>
    !busy.value &&
    session.value.previewEntry !== null &&
    (session.value.hasDraft || session.value.previewSize !== null),
);
/**
 * There is something on disk to zip up.
 *
 * Not `canSave`: that one asks whether the preview is far enough along to be
 * kept, and a widget that was saved yesterday and has no draft open fails it
 * while sitting complete in the extensions folder. Export only needs the files
 * to exist — as a draft, as a saved widget, or as both.
 */
const canExport = computed(
  () =>
    !busy.value &&
    !!session.value.packageId &&
    (session.value.hasDraft ||
      myWidgets.value.some((widget) => widget.id === session.value.packageId)),
);
const previewTitle = computed(
  () => session.value.widgetName.trim() || session.value.packageId || "Preview",
);

/**
 * Persist preview geometry after the gesture ends, not on every pointer move.
 *
 * The files are updated in memory immediately so the manifest editor and the
 * next model turn see the chosen values. The write is serialized because a
 * quick second resize must not let an older draft write finish last.
 */
let previewSettingsWrite: Promise<void> = Promise.resolve();

function onPreviewResized(size: { w: number; h: number }, scale?: number) {
  const targetSession = session.value;
  const id = targetSession.packageId;
  targetSession.previewSize = size;
  if (typeof scale === "number") targetSession.previewScale = scale;

  const files = targetSession.draftFiles;
  if (!files || !id) {
    void save(targetSession);
    return;
  }

  let next = withDefaultSize(files, size);
  if (targetSession.previewScale !== null) {
    next = withDefaultScale(next, targetSession.previewScale);
  }
  targetSession.draftFiles = next;

  const write = () => writeDraftFiles(id, next).then(() => save(targetSession));
  previewSettingsWrite = previewSettingsWrite.then(write, write);
  void previewSettingsWrite.catch((error) => note(describeDraftError(String(error))));
}

onMounted(async () => {
  const subscription = wizard.onDraftChanged(handleDraftChanged);
  void subscription
    .then((stop) => {
      if (draftEventsDisposed) {
        stop();
      } else {
        stopDraftEvents = stop;
      }
    })
    .catch(() => undefined);
  const presenceSubscription = wizard.onDraftPresenceChanged(handleDraftPresence);
  void presenceSubscription
    .then((stop) => {
      if (draftEventsDisposed) {
        stop();
      } else {
        stopDraftPresenceEvents = stop;
      }
    })
    .catch(() => undefined);
  let presenceTicks = 0;
  presenceTimer = setInterval(() => {
    const now = Date.now();
    presenceNow.value = now;
    draftPresences.value = draftPresences.value.filter(
      (presence) => presence.active || presence.expiresAt > now,
    );
    presenceTicks += 1;
    if (presenceTicks % 10 === 0) void refreshDraftPresence();
  }, 1_000);
  // Before the lists arrive, so the first render is already in the person's
  // order rather than jumping into it a tick later.
  await hydrateProjectOrder();
  await Promise.all([
    loadModels(),
    loadProviders(),
    refresh(),
    loadMyWidgets(),
    refreshDrafts(),
    refreshDraftPresence(),
  ]);
  await reconcileActiveDraftFromList();
});

async function loadModels() {
  try {
    // Sorted so the list never opens with something that cannot run, and the
    // selection lands on a model that has a key.
    models.value = sortWizardModels(await wizard.models<WizardModelOption[]>());
    session.value.model = defaultWizardModel(models.value, session.value.model);
  } catch (error) {
    note(`Could not read the model list: ${String(error)}`);
  }
}

/**
 * Every package id this machine already answers to.
 *
 * Drafts and saved widgets are one namespace, not two: promoting a draft onto
 * a saved id is refused, so a name that is only free among drafts is not free.
 */
function takenPackageIds(): string[] {
  return [...drafts.value.map((draft) => draft.id), ...myWidgets.value.map((widget) => widget.id)];
}

/** Custom-root packages, the only ones the wizard may read or replace. */
async function loadMyWidgets() {
  try {
    const rows = await rescan();
    myWidgets.value = rows
      .filter((row) => row.origin === "custom")
      .map((row) => ({ id: row.id, name: row.name || row.id, updatedAt: row.updatedAt ?? null }));
  } catch {
    myWidgets.value = [];
  }
}

/**
 * Open a sidebar row.
 *
 * A row is a widget, and a widget is opened the same way whoever last touched
 * it: through the draft workspace. Only a conversation that never produced a
 * package has nothing to open but itself.
 */
async function openRow(row: ProjectRow): Promise<void> {
  /**
   * The project that is already open has nothing left to open, so the click was
   * about the list: fold it, or unfold it.
   *
   * Re-opening it instead would cost a round trip to the draft service and add
   * another "Editing…" line to a transcript nobody asked to change — which is
   * how a fold control ends up needing to be a separate button.
   */
  if (isActiveRow(row)) {
    toggleRowHistory(row);
    return;
  }
  expandRow(row.key);
  if (row.packageId) {
    await openWidget(row.packageId, row.conversationIds[0] ?? null);
    return;
  }
  const conversationId = row.conversationIds[0];
  if (conversationId) await openConversation(conversationId);
}

/**
 * Start a new conversation inside a project.
 *
 * The project — the widget, its draft, its files, its grants — is the same one;
 * only the transcript is new. That is the useful shape when a widget has been
 * built and the next thing is unrelated to how it got built: the model still
 * receives the current files with every message, so a fresh conversation is a
 * clean prompt, not a lost widget.
 */
function newConversationIn(row: ProjectRow): void {
  if (!row.packageId) return;
  expandRow(row.key);
  void openWidget(row.packageId, null);
}

function expandRow(key: string): void {
  if (!expandedRows.value.includes(key)) expandedRows.value = [...expandedRows.value, key];
}

/**
 * Delete one of your own widgets. Armed by `deleteRow`, never called bare.
 *
 * There is no undo — the files are gone and the grants with them — so the first
 * click only arms it. A modal for this would be heavier than the action; a
 * button that changes to "Sure?" says the same thing and can be walked away
 * from.
 */
async function deleteWidget(id: string) {
  if (!id) return;
  busy.value = true;
  try {
    await wizard.runtimeDeletePackage(id);
    // The draft is deliberately left alone. Deleting a widget is one decision;
    // throwing away changes nobody has read is another, and doing the second
    // silently because somebody asked for the first is how unsaved work
    // disappears. The row stays in the list, now as a draft.
    const draftRemains = drafts.value.some((draft) => draft.id === id);
    note(
      draftRemains
        ? `Deleted "${id}". Its unsaved draft is still here — discard it separately.`
        : `Deleted "${id}".`,
    );
    if (session.value.packageId === id && !draftRemains) {
      session.value.hasDraft = false;
      session.value.draftRevision = undefined;
      session.value.draftError = undefined;
      session.value.previewEntry = null;
      session.value.draftFiles = null;
    }
    await Promise.all([loadMyWidgets(), refreshDrafts()]);
  } catch (error) {
    note(describeDraftError(String(error)));
  } finally {
    busy.value = false;
  }
}

/** Throw away a draft that is not the one on screen. */
async function discardDraftById(id: string): Promise<void> {
  if (!id || busy.value) return;
  busy.value = true;
  try {
    await wizard.draftDiscard(id);
    note(`Discarded the draft for "${id}".`);
    if (session.value.packageId === id) {
      session.value.hasDraft = false;
      session.value.draftRevision = undefined;
      session.value.draftError = undefined;
      session.value.previewEntry = null;
      session.value.draftFiles = null;
      draftConflict.value = null;
    }
    await Promise.all([save(session.value), refreshDrafts()]);
  } catch (error) {
    note(describeDraftError(String(error)));
  } finally {
    busy.value = false;
  }
}

function note(text: string, tone?: "success") {
  appendNote(session.value.bubbles, { role: "system", text, ...(tone ? { tone } : {}) });
  scrollDown();
}

function scrollDown() {
  void nextTick(() => {
    const el = transcriptEl.value;
    if (el) el.scrollTop = el.scrollHeight;
  });
}

// --- attachments -----------------------------------------------------------

/**
 * Read dropped, pasted or picked files into the pending attachment list.
 *
 * Each is checked before it is read: a 30 MB photo should be refused on the
 * drop, not after the browser has spent a second turning it into base64.
 */
async function attach(files: FileList | File[] | null) {
  if (!files) return;
  for (const file of Array.from(files)) {
    const problem = attachmentProblem(file, session.value.attachments.length);
    if (problem) {
      note(problem);
      continue;
    }
    try {
      session.value.attachments.push({
        mediaType: file.type,
        data: base64FromDataUrl(await readAsDataUrl(file)),
      });
    } catch {
      note(`Could not read ${file.name}.`);
    }
  }
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("read_failed"));
    reader.readAsDataURL(file);
  });
}

function removeAttachment(index: number) {
  session.value.attachments.splice(index, 1);
}

function onFilePicked(event: Event) {
  const input = event.target as HTMLInputElement;
  void attach(input.files);
  // Clear it, or picking the same file twice in a row does nothing.
  input.value = "";
}

/** A thumbnail source for an attachment already stripped of its prefix. */
function thumbSrc(image: WizardAttachment): string {
  return `data:${image.mediaType};base64,${image.data}`;
}

// --- conversations ---------------------------------------------------------

async function newConversation() {
  await save(session.value);
  start();
  draftConflict.value = null;
  savedApiText.value = null;
  session.value.model = defaultWizardModel(models.value);
  middleTab.value = "chat";
  // A new project is a question waiting to be typed, so the caret goes where
  // the typing starts rather than leaving somebody to find the box first.
  void nextTick(() => composerEl.value?.focus());
}

/**
 * "New Widget" from the palette.
 *
 * The host has already revealed or created this card by the time the action
 * runs; all that is left is which project it shows. Two routes into the same
 * place, because the action can arrive on either side of a mount: a bump of the
 * signal while the card is up, and a flag in `ctx.data` when it was not.
 */
/**
 * Start a project the way the palette means it: nothing but the question.
 *
 * Separate from `newConversation` because the sidebar's own "+ New project"
 * button must not fold the sidebar away underneath the pointer that just used
 * it — the same act, arrived at from two places that want two different amounts
 * of chrome.
 */
async function startProjectFromPalette(): Promise<void> {
  await newConversation();
  composing.value = true;
  sidebarTucked.value = true;
}

/**
 * The host handing this card the caret.
 *
 * The one place a "New Widget" request can be redeemed, because it is the only
 * signal that names the card the host actually opened — revealed, focused or
 * freshly made. Reaching for a live instance from the action instead would be
 * this code guessing, and guessing wrong whenever there are two Wizards.
 *
 * Without a request pending it does what the event is for everywhere else: puts
 * the caret where typing starts.
 */
function onFocusRequest(event: Event): void {
  if (!widgetFocusRequestMatches(event, props.model.instanceId)) return;
  const openPackageId = (event as CustomEvent<WidgetFocusRequestDetail>).detail
    ?.openPackageId;
  if (openPackageId) {
    /**
     * A widget's own card sent us here through its "Edit in Wizard" menu item.
     *
     * The host dispatches this focus twice — once now and once 60 ms later, for
     * a card that was still mounting — so the already-open check is what keeps
     * one menu click from opening the same draft twice.
     */
    if (session.value.packageId !== openPackageId) void openWidget(openPackageId);
    return;
  }
  if (takeNewProjectRequest()) {
    void startProjectFromPalette();
    return;
  }
  composerEl.value?.focus();
}

onMounted(() => window.addEventListener(WIDGET_FOCUS_EVENT, onFocusRequest));
onUnmounted(() => window.removeEventListener(WIDGET_FOCUS_EVENT, onFocusRequest));

async function openConversation(id: string) {
  // A transcript about a widget is only the conversation half of that project.
  // Reopen the project through the draft service so an MCP revision written
  // since this transcript was saved is visible immediately.
  const packageId = conversationHeaderFor(id)?.packageId;
  if (packageId) {
    await openWidget(packageId, id);
    return;
  }
  if (id === session.value.id) return;
  composing.value = false;
  await save(session.value);
  const loaded = await load(id);
  if (loaded) {
    loaded.model = defaultWizardModel(models.value, loaded.model);
    session.value = loaded;
    draftConflict.value = null;
    savedApiText.value = loaded.packageId
      ? ((await readSavedFiles(loaded.packageId))?.find((file) => file.path === "api.json")
          ?.contents ?? null)
      : null;
    scrollDown();
  } else {
    note("That conversation could not be opened.");
  }
}

async function deleteConversation(id: string) {
  await remove(id);
  if (id === session.value.id) start();
}

// --- naming ----------------------------------------------------------------

/**
 * Renaming moves the widget, rather than starting it again.
 *
 * The manifest is the package's identity — the host moves the folder to
 * whatever it names — so a rename is one patched field and a write. What used
 * to happen here was a discard: the draft was thrown away and the person was
 * told the next change would rebuild it under the new name, which spent a
 * generation, and their edits, on a change of name.
 *
 * Patching the manifest is not optional. Retargeting `packageId` alone would be
 * undone by the very next write, which reads the old name out of the manifest
 * and moves the folder straight back.
 */
async function onNameChanged() {
  const previous = session.value.packageId;
  const next = packageIdFor(session.value, session.value.bubbles[0]?.text ?? "");
  if (!previous) {
    if (session.value.widgetName.trim()) session.value.packageId = next;
    return;
  }
  if (previous === next) return;

  // Nothing written yet, so there is nothing to move: the first write lands
  // under the new name on its own.
  const files = session.value.draftFiles;
  if (!files || files.length === 0) {
    session.value.packageId = next;
    await save(session.value);
    return;
  }

  const renamed = withPackageId(files, next);
  busy.value = true;
  try {
    // The write answers about the new folder and `writeDraftFiles` follows it,
    // so `packageId` is retargeted by the same call that moved the files.
    await writeDraftFiles(previous, renamed);
    session.value.draftFiles = renamed;
    session.value.hasDraft = true;
    // The name is now part of the package, so it is part of the version the
    // person can go back to.
    session.value.versions = updateLiveVersion(
      session.value.versions,
      session.value.currentVersion,
      renamed,
    );
    if (session.value.editing && session.value.editing !== next) {
      note(`Save to rename "${session.value.editing}" on your desk too.`);
    }
  } catch (error) {
    note(describeDraftError(String(error)));
  } finally {
    busy.value = false;
    await save(session.value);
  }
}

// --- the conversation ------------------------------------------------------

async function send() {
  if (!canSend.value) return;
  syncComposerDraft();
  firstVersionGeneration.value = !session.value.hasDraft && !session.value.previewEntry;
  const request = session.value.draft;
  const elements = pointAndPromptEnabled ? selectedElements.value : [];
  const { text, elementReferences } = pointAndPromptTranscript(request, elements);
  clearPreviewSelection();
  session.value.draft = "";

  /**
   * Deliberately not named yet on the first turn.
   *
   * `packageIdFor` slugs whatever it is given, and on turn one that is the
   * whole request — which is how a widget came to be called
   * `a-tracker-for-how-much-water-i-drink`. The model reads the request anyway
   * and names the thing; the id is adopted from the manifest it writes. A name
   * the person typed still wins, because they said it on purpose.
   */
  if (!session.value.packageId && session.value.widgetName.trim()) {
    session.value.packageId = packageIdFor(session.value, text);
  }
  const id = session.value.packageId ?? "";

  const images = session.value.attachments;
  session.value.attachments = [];

  session.value.bubbles.push({
    role: "user",
    text,
    elementReferences,
    ...(images.length ? { images } : {}),
  });
  session.value.turns.push({
    role: "user",
    /**
     * The files as they are on disk right now, every turn — not only when a
     * saved widget is opened.
     *
     * The model returns the complete set each time and otherwise reasons from
     * its own last output, so anything edited by hand in between was silently
     * overwritten by the next reply. That made the manifest editor a trap: it
     * wrote to disk, the preview updated, and the next sentence undid it.
     */
    content: turnForPackage(pointAndPromptRequest(request, elements).trim(), id, {
      currentFiles: session.value.draftFiles ?? undefined,
      knownFiles: session.value.knownFiles,
      samples: session.value.samples,
    }),
    ...(images.length ? { images } : {}),
  });
  // Folded into the turn above, so they belong to the conversation now. Marked
  // rather than dropped: the person still wants to see what came back, and a
  // sample resent every turn would be the same tokens billed again for a fact
  // the model already has.
  for (const sample of session.value.samples ?? []) sample.sent = true;
  scrollDown();

  const mine = ++generation.value;
  busy.value = true;
  try {
    await runTurn(mine, id, REPAIR_BUDGET);
  } catch (error) {
    if (mine === generation.value) note(describeWizardError(String(error)));
  } finally {
    if (mine === generation.value) {
      busy.value = false;
      firstVersionGeneration.value = false;
    }
    await save(session.value);
    scrollDown();
  }

  if (mine === generation.value) await autoSaveContractPreview();
}

/**
 * Save a contract package on its own, so the preview has something to show.
 *
 * A contract widget cannot run as a draft: it reads from a provider, the grant
 * lives on the install record, and a draft has no install record — so the
 * preview of every unsaved contract package is the "Not approved yet" gate.
 * That is honest and it is also the whole preview, which for the one format
 * whose point is reading real data means iterating blind.
 *
 * On the same switch as the consent it skips, and for the same reason: it turns
 * an iteration loop into one step, and it does something a person would
 * otherwise be doing by hand every turn. Off by default, because saving puts a
 * widget in the palette and that is not a side effect to hand out unasked.
 *
 * Outside the turn rather than inside it: `keep` refuses to run while `busy` is
 * set, which it is for the whole generation.
 */
async function autoSaveContractPreview(): Promise<void> {
  if (!wizardAutoEnable.value || busy.value) return;
  if (previewFormat.value !== "contract") return;
  // Nothing to promote, or something the validator already refused: saving a
  // broken package would replace a working widget with it.
  if (!session.value.hasDraft || session.value.draftError) return;
  if (!session.value.packageId || !session.value.previewEntry) return;
  /**
   * A question already on screen is not asked again.
   *
   * When the grant cannot be given automatically — a provider this machine does
   * not have — `keep` puts the consent screen in the transcript instead. Saving
   * again next turn would put a second one under it, and a third, each about the
   * same package and the same unanswerable request.
   */
  const asking = session.value.bubbles.some(
    (bubble) => bubble.approve?.id === session.value.packageId && !bubble.approve.done,
  );
  if (asking) return;
  await keep();
}

/**
 * One round trip to the model, and the package that came back.
 *
 * Recursive rather than a loop because a repair *is* another turn — same
 * request, same checks, same chance of coming back broken. `repairsLeft` is
 * what stops it; see `REPAIR_BUDGET` for why that number is one.
 *
 * Everything here runs with `busy` already true and the person already
 * waiting, which is the whole reason the retry is automatic rather than a
 * button: it costs them a second of a wait they were in anyway.
 */
async function runTurn(mine: number, id: string, repairsLeft: number, repairFiles?: GeneratedFile[]): Promise<void> {
  const reply = await wizard.complete<{ text: string; model?: string; usage?: unknown }>({
    model: session.value.model,
    messages: session.value.turns,
    // A format, not a prompt: the host decides what the model is told from
    // this, so nothing here can loosen what the output is checked against.
    format: format.value,
    // Likewise ids, not blocks. The host holds every provider's description
    // and splices the ones named here.
    providers: [...(session.value.providers ?? [])],
    // Omitted when there is none: absent means "the model's own default", and
    // on OpenAI the vocabulary contains `none`, so sending an empty choice
    // would read as "do not reason" rather than "no preference".
    ...(effort.value ? { effort: effort.value } : {}),
  });
  // Dropped rather than applied when it was cancelled: writing a draft for a
  // question the person walked away from is worse than losing the answer. The
  // same check is what stops a repair in flight after `stop()`.
  if (mine !== generation.value) return;
  session.value.turns.push({ role: "assistant", content: reply.text });

  // Counted by the provider, not estimated here. A repair round is a second
  // request and lands as its own line, which is the honest presentation — it
  // is a turn the person did not ask for and did pay for.
  const spent = readUsage(reply.usage);
  session.value.usage = addUsage(session.value.usage ?? NO_USAGE, spent);

  /**
   * Priced now, against the model the backend says actually answered — not
   * against whatever the picker holds later.
   *
   * `reply.model` rather than `session.model`: the picker can move while a
   * request is in flight, and the model that ran is the one that billed.
   */
  const ranOn = models.value.find((model) => model.id === reply.model);
  const cost = estimateCost(spent, ranOn?.pricing);
  session.value.cost = addCost(session.value.cost, cost);

  const parsed = parseGeneratedFiles(reply.text);
  const before = repairFiles ?? session.value.draftFiles ?? [];
  // Held rather than pushed and forgotten: the version it produces does not
  // exist until the write below succeeds, and it is marked on this bubble.
  const answer: WizardBubble = {
    role: "assistant",
    // A model that sends files and no prose gets described by what it did,
    // rather than by a placeholder complaining that it said nothing.
    text: parsed.prose || describeReply(parsed, before),
    usage: spent,
    model: ranOn?.label ?? reply.model,
    modelCredentialType: ranOn?.credentialType,
    cost,
  };
  session.value.bubbles.push(answer);

  // A reply with no usable files never reaches disk, so there is nothing to
  // write and nothing to offer — but it is the most repairable failure there
  // is, because it is entirely the model's own doing.
  // The answer is applied to the package rather than replacing it: a follow-up
  // turn is asked for only what it changed, so `parsed.files` is usually a
  // fraction of the widget. A complete answer merges to itself, so nothing here
  // depends on which kind arrived.
  const merged = withoutOtherFormat(before, mergeGeneratedFiles(before, parsed));
  const problem = replyProblem(parsed, merged, id, format.value);
  /**
   * The id the model chose, on the turn where nothing was named yet.
   *
   * Taken from the manifest rather than from a rename afterwards: the write is
   * the thing that creates the folder, so writing to a placeholder first would
   * make a directory only to move it, and leave the id wrong for the moment the
   * preview mounts. The slug of the request stays as the fallback for a
   * manifest that named nothing usable — the validator has already refused
   * that case, so this is a belt for a broken repair round.
   */
  const chosen =
    id ||
    declaredPackageId(merged, format.value) ||
    packageIdFor(session.value, session.value.bubbles.find((b) => b.role === "user")?.text ?? "");
  /**
   * A name the model chose may already be taken here — by a draft, or by a
   * widget on the desk. The wizard is the only party that knows that, so it
   * settles it instead of sending the answer back as broken and spending a
   * repair turn on a name that was perfectly good.
   */
  const target = id || freePackageId(chosen, takenPackageIds());
  /**
   * And the manifest has to carry it. The folder is named by the manifest —
   * writing suffixed files whose manifest still says the original renames the
   * draft straight back onto the name it was avoiding.
   */
  const files = target === chosen ? merged : withPackageId(merged, target);
  const outcome = problem
    ? { written: false, problems: [problem] }
    : await writeDraft(target, files);

  if (outcome.written && !id) {
    session.value.packageId = target;
    // And its name, when the person did not type one. They are answering a
    // different question — "what is this called on my desk" — and until they
    // do, what the model called it beats an empty field.
    if (!session.value.widgetName.trim()) {
      session.value.widgetName = declaredDisplayName(merged) ?? target;
    }
  }

  if (outcome.written) {
    answer.version = session.value.currentVersion;
    // The written set, not `parsed.files`: the model wrote the changed files a
    // message ago and saw the rest earlier in the same conversation, so the
    // package it is holding is the merged one — with whatever the id had to
    // become patched into it, which is what is on disk.
    session.value.knownFiles = files;
  }

  if (outcome.problems.length > 0 && outcome.hopeless) {
    for (const problem of outcome.problems) note(problem);
    return;
  }

  if (outcome.problems.length > 0 && repairsLeft > 0) {
    await askForRepair(
      mine,
      id,
      outcome.problems,
      repairsLeft - 1,
      outcome.problems.length === 1
        ? `That package has a problem — asking for a fix: ${outcome.problems[0]}`
        : `That package has ${outcome.problems.length} problems — asking for a fix.`,
      files,
    );
    return;
  }

  for (const each of outcome.problems) note(each);
  if (mine === generation.value && outcome.written && outcome.problems.length === 0) {
    answer.suggestions = parsed.suggestions;
  }
  // Last, so the offer describes the package that is actually on disk. Skipped
  // entirely when a repair is coming: the next generation rewrites api.json,
  // and an offer for the version being replaced is one the person would be
  // reading about a widget that no longer exists.
  if (outcome.written) offerEnable(id, merged);
}

/**
 * Hand the problems back to the model and go round again.
 *
 * The turn is recorded as a `user` message because that is the only role the
 * model can be spoken to in — but the transcript shows a system note instead,
 * since the person did not say it. A silent retry would be worse: it is their
 * tokens, and a second answer appearing with no explanation reads as the model
 * changing its mind.
 */
async function askForRepair(
  mine: number,
  id: string,
  problems: string[],
  repairsLeft: number,
  announcement: string,
  repairFiles?: GeneratedFile[],
) {
  session.value.bubbles.push({ role: "system", text: announcement });
  session.value.turns.push({ role: "user", content: repairTurnFor(problems) });
  scrollDown();
  // Rejected files never become the live draft. Keep their complete set here
  // so a repair returning only widget.js still retains its HTML and manifest.
  await runTurn(mine, id, repairsLeft, repairFiles);
}

/**
 * Hand the preview the grants the package actually holds.
 *
 * `RuntimeExtensionFrame` refuses a declared-endpoint call frontend-side when
 * `grantedPermissions` lacks `network.declared`, before the backend is asked at
 * all. The preview runs on `previewPermissionsFor`, which is storage-only by
 * design — right for a draft, which holds no grants, but wrong the moment the
 * package is enabled: the call would still be refused here while the same
 * widget works from the palette, where the real record is passed.
 *
 * Read after `setEnabled`, which refreshes `installs` from the backend's reply,
 * so this is the record as Rust just wrote it rather than a guess.
 */
/**
 * Consent lines the person already approved for `id`, or null if none stand.
 *
 * Read from the installed package, which is the version they said yes to. Used
 * to tell "this asks for something new" apart from "this is the same widget
 * again": only the first is worth a second reading.
 */
function grantedConsentLines(id: string): string[] | null {
  const record = installs.value.find((install) => install.id === id);
  if (!record?.enabled) return null;
  const row = scanned.value.find((scanned) => scanned.id === id);
  return row ? consentLinesFor(row) : null;
}

function adoptGrantedPermissions(id: string) {
  const record = installs.value.find((install) => install.id === id);
  // No record, or one that is switched off, means there is nothing to adopt —
  // leave the draft subset in place rather than replacing it with an empty
  // list, which would take storage away from a widget that still has it.
  if (!record?.enabled) return;
  session.value.previewPermissions = [...record.grantedPermissions];
}

/**
 * Grant what the bubble listed, after the person read it and pressed Enable.
 *
 * The consent itself is unchanged — same lines, same grant, same backend call
 * as Settings → Extensions. Only the walk over there is gone, so the button may
 * never enable anything the bubble did not spell out.
 */
async function enableFromBubble(bubble: WizardBubble) {
  const action = bubble.enable;
  if (!action || action.done || busy.value) return;
  busy.value = true;
  try {
    // A draft cannot hold a grant, so granting means saving first. The button
    // is labelled for it, so this is the promised behaviour, not a side effect.
    if (action.needsSave && !(await promoteDraft(action.id))) return;
    // The bubble may be older than the package: regenerating a widget leaves
    // the previous note sitting in the transcript, still clickable. Granting
    // from it would approve today's package while showing yesterday's list, so
    // the lines are rebuilt and compared before anything is granted.
    const current = (await rescan()).find((scanned) => scanned.id === action.id);
    if (!current) {
      note(`"${action.id}" is not there any more.`);
      return;
    }
    const lines = consentLinesFor(current);
    if (JSON.stringify(lines) !== JSON.stringify(action.lines)) {
      action.lines = lines;
      note(`What "${action.id}" asks for changed. Read it again, then enable.`);
      await save(session.value);
      return;
    }
    if (await enablePackage(action.id)) {
      // Marked on the bubble, not in a local ref: the transcript is persisted,
      // and a reload must not offer the same grant again.
      action.done = true;
      session.value.hasDraft = false;
      session.value.draftRevision = undefined;
      session.value.draftError = undefined;
      session.value.editing = action.id;
      adoptGrantedPermissions(action.id);
      // The frame already rendered — under the real package id, but before the
      // grant existed, so it is showing "network permission was not granted".
      // Nothing about its url changes here, so only a nonce bump remounts it
      // and lets the preview show live data instead of the refusal.
      previewNonce.value += 1;
      if (action.preApproved) {
        note(`"${action.id}" updated. The preview is running the saved version.`, "success");
      } else {
        // Same offer as the other two save paths: the thing anybody wants
        // right after enabling a widget is to look at it.
        session.value.bubbles.push({
          role: "system",
          tone: "success",
          text: `"${action.id}" is on.`,
          run: { id: action.id },
        });
        scrollDown();
      }
      await Promise.all([save(session.value), loadMyWidgets(), refreshDrafts()]);
    } else {
      note(`"${action.id}" could not be enabled. See Settings -> Extensions.`);
    }
  } catch (error) {
    note(describeDraftError(String(error)));
  } finally {
    busy.value = false;
  }
}

/**
 * The approval request for one bubble, rebuilt from the package on disk.
 *
 * Never read from the bubble. A transcript outlives regenerations, so a request
 * stored at the time the note was written would be describing a package that
 * has since changed — and the one thing a consent screen may not do is show an
 * old list while granting against a new manifest.
 *
 * Returns undefined when the package is gone or its manifest cannot be read;
 * the bubble then says so instead of rendering an empty dialog.
 */
/**
 * What this package was already granted, or null when it is not installed and
 * enabled.
 *
 * The install record is the only place a grant lives — read back rather than
 * remembered in the session, so a transcript restored on another day cannot
 * carry a grant that Settings has since withdrawn.
 */
function approvedGrantFor(id: string): WizardApprovedGrant | null {
  const record = installs.value.find((install) => install.id === id);
  if (!record?.enabled || !record.contractGrant) return null;
  // Every older spelling folded in rather than assumed migrated: the backend
  // rewrites on load, but a session restored beside a stale scan would
  // otherwise report "nothing approved" and re-open a dialog nobody needs.
  const grant = record.contractGrant;
  return {
    providers:
      grant.approved ??
      grant.providers?.map((row) => row.provider) ??
      (grant.provider ? [grant.provider] : []),
    actions: grant.actions ?? {},
  };
}

/**
 * What the widget on the stage still cannot read.
 *
 * Empty while it is a draft — a draft has no install record and the preview
 * already says so with its own panel. This is the state *after* saving, where
 * the package is loaded and would otherwise mount and fail.
 */
const previewUnmet = computed(() => {
  const id = session.value.packageId;
  if (!id || session.value.hasDraft || previewFormat.value !== "contract") return [];
  const request = approvalRequestFor(id);
  return request ? unmetProviders(request, approvedGrantFor(id)?.providers) : [];
});

const canPickElement = computed(() => pointAndPromptEnabled && !!previewUrl.value
  && !busy.value && !sharing.value && !tooNarrow.value && !draftConflict.value
  && !draftEditorDirty.value && !session.value.draftError && !previewUnmet.value.length);
watch([() => session.value.id, previewUrl, previewNonce, () => session.value.currentVersion],
  clearPreviewSelection, { flush: "sync" });
watch(canPickElement, (available) => { if (!available) clearPreviewSelection(); }, { flush: "sync" });

function approvalRequestFor(id: string): WizardPermissionRequest | undefined {
  const row = scanned.value.find((scanned) => scanned.id === id);
  if (!row || row.format !== "contract" || row.contractManifest === undefined) return undefined;
  return buildWizardPermissionRequest(
    row.contractManifest,
    providerSchemas.value,
    approvedGrantFor(id) ?? undefined,
  );
}

/**
 * What to call the package in the dialog's first line.
 *
 * The scan row's name, not the folder id: "Add fdssd?" asks somebody to approve
 * a directory. The name is what they typed into the wizard, and it is the only
 * form they will recognise.
 */
function approvalNameFor(id: string): string {
  const row = scanned.value.find((scanned) => scanned.id === id);
  return row?.name?.trim() || id;
}

/**
 * Register a grant and bring the widget up. Shared by the dialog and by the
 * path that skips it, so "approved just now" and "approved earlier and
 * unchanged" cannot drift into behaving differently.
 */
async function applyContractGrant(
  id: string,
  grant: WizardApprovedGrant,
  run: boolean,
  /**
   * Appended to the note this ends with, when the grant was not asked for.
   *
   * One line rather than a second note beside it: with auto-save armed this
   * runs on every turn, and two lines per turn is a transcript of bookkeeping
   * with a conversation somewhere inside it. Never silent, though — a grant
   * that happened without being asked for is the part that would be
   * indefensible to leave unsaid.
   */
  how = "",
): Promise<boolean> {
  const actions = Object.fromEntries(
    Object.entries(grant.actions)
      .filter(([, names]) => (names?.length ?? 0) > 0)
      .map(([provider, names]) => [provider, [...(names ?? [])]]),
  );
  if (!(await enablePackage(id, { approved: [...grant.providers], actions }))) {
    note(`"${id}" could not be enabled. See Settings -> Extensions.`);
    return false;
  }
  session.value.hasDraft = false;
  session.value.draftRevision = undefined;
  session.value.draftError = undefined;
  session.value.editing = id;
  // The preview frame is mounted under the real id but was refused before the
  // grant existed. Its url does not change, so only a remount lets it run.
  previewNonce.value += 1;
  if (run) {
    window.dispatchEvent(
      new CustomEvent("kavibay:run-runtime-widget", { detail: { typeId: id } }),
    );
    note(`"${id}" is on and opening on the desk.`, "success");
  } else {
    session.value.bubbles.push({
      role: "system",
      tone: "success",
      text: `Saved "${id}".${how}`,
      run: { id },
    });
    scrollDown();
  }
  await Promise.all([save(session.value), loadMyWidgets(), refreshDrafts()]);
  return true;
}

async function approveFromBubble(bubble: WizardBubble, grant: WizardApprovedGrant) {
  const action = bubble.approve;
  if (!action || action.done || busy.value) return;
  busy.value = true;
  try {
    // The package may have been deleted or regenerated since the note was
    // written; a grant against something that is not there any more is worse
    // than no grant.
    await rescan();
    if (!approvalRequestFor(action.id)) {
      note(`"${action.id}" is not there any more.`);
      return;
    }
    if (!(await applyContractGrant(action.id, grant, action.run === true))) return;
    // On the bubble, not in a local ref: the transcript is persisted, and a
    // restored one must not offer the same grant a second time.
    action.done = true;
  } catch (error) {
    note(describeDraftError(String(error)));
  } finally {
    busy.value = false;
  }
}

/** Tallest the composer may grow before it scrolls instead. */
const COMPOSER_MAX_HEIGHT = 160;
/** Height at `rows="3"`, measured once so the empty box keeps its old size. */
let composerBaseHeight = 0;

/**
 * Grow the composer with its content, up to a cap, then let it scroll.
 *
 * Height comes from `scrollHeight`, which excludes the border that `height`
 * includes under the global `box-sizing: border-box` — so the difference is
 * added back. Measured at one pixel here, and Chromium happens to tolerate its
 * absence; the correction is for exactness, not a bug it was seen to fix. It
 * earns its place if the border ever grows or a horizontal scrollbar appears,
 * both of which `offsetHeight - clientHeight` absorbs on its own.
 */
function resizeComposer() {
  const el = composerEl.value;
  if (!el) return;
  el.style.height = "auto";
  const chrome = el.offsetHeight - el.clientHeight;
  const wanted = el.scrollHeight + chrome;
  el.style.height = `${Math.max(composerBaseHeight, Math.min(wanted, COMPOSER_MAX_HEIGHT))}px`;
}

onMounted(() => {
  renderComposer();
  // Measured before any explicit height exists, so the empty box keeps its
  // intended three-line starting size rather than something this function set.
  composerBaseHeight = composerEl.value?.offsetHeight ?? 0;
  resizeComposer();
});

// Covers typing, clearing after a send, and a conversation reopened with a
// half-written draft in it — all three end up here rather than at three call
// sites that can each be forgotten.
watch(
  () => session.value.draft,
  () =>
    void nextTick(() => {
      if (composerText() !== session.value.draft) renderComposer();
      resizeComposer();
    }),
);

// Provider schemas arrive asynchronously. Render a stored `@Provider` mention
// once the matching logo is available, without rebuilding an editor that
// already contains live mention nodes while somebody is typing.
watch(
  providerOptions,
  () =>
    void nextTick(() => {
      const draft = session.value.draft;
      const hasKnownMention = providerOptions.value.some((option) => draft.includes(`@${option.label}`));
      const hasRenderedMention = Boolean(composerEl.value?.querySelector(".wiz-inline-mention"));
      if (hasKnownMention && !hasRenderedMention) renderComposer();
      resizeComposer();
    }),
  { deep: true },
);

/**
 * The preview run a fault has already been offered for.
 *
 * One offer per run, not one per fault. A widget that throws inside a timer
 * produces the same fault every second, and a transcript growing a new button
 * every second is not an offer, it is a fire alarm. The first one carries the
 * message; the rest are in the debug panel, which is where a list belongs.
 */
const faultOfferedFor = ref(-1);

/**
 * A fault from the running preview, offered as something to hand back.
 *
 * Not sent automatically. See `WizardBubble.repair` — a widget throws for
 * reasons a regeneration cannot touch, and the person is the only one here who
 * knows whether the token is set or the API is up.
 */
function onPreviewFault(fault: PreviewFault) {
  // Mid-turn faults belong to a package that is already being replaced.
  if (busy.value || !session.value.packageId) return;
  if (faultOfferedFor.value === previewNonce.value) return;
  faultOfferedFor.value = previewNonce.value;

  const problem = faultProblem(fault);
  session.value.bubbles.push({ role: "system", text: problem, repair: { problems: [problem] } });
  scrollDown();
  void save(session.value);
}

/**
 * Send one offered fault back to the model.
 *
 * No repair budget left over: the click *is* the budget. If the fix comes back
 * broken too, that is worth a person's attention rather than another automatic
 * round — at that point the model has failed at this problem twice.
 */
async function repairFromBubble(bubble: WizardBubble) {
  const action = bubble.repair;
  const id = session.value.packageId;
  if (!action || action.done || busy.value || !id) return;
  action.done = true;

  const mine = ++generation.value;
  busy.value = true;
  try {
    await askForRepair(mine, id, action.problems, 0, "Sending that error back for a fix.");
  } catch (error) {
    if (mine === generation.value) note(describeWizardError(String(error)));
  } finally {
    if (mine === generation.value) busy.value = false;
    await save(session.value);
    scrollDown();
  }
}

/**
 * Remember the package as it now stands, under what produced it.
 *
 * Called from every path that writes the draft. Missing one would not break
 * anything visibly — it would leave a gap in the history that only shows up on
 * the day somebody needs the version that is not there.
 */
function rememberVersion(
  files: GeneratedFile[],
  label: string,
  author: DraftAuthor = null,
  clientName: string | null = null,
) {
  const update = recordVersion(
    session.value.versions,
    session.value.currentVersion,
    files,
    label,
    undefined,
    author,
    clientName,
  );
  session.value.versions = update.versions;
  session.value.currentVersion = update.current;
}

/**
 * Put an earlier version back on disk.
 *
 * A full `draftWrite`, the same call a generation makes — the package on disk
 * is what the preview loads, so restoring has to be a real write and not a
 * change of pointer.
 *
 * No new entry is recorded. The version being left is already in the list, so
 * going back is not a one-way door: the thing that made this worth building is
 * that trying something costs nothing.
 */
async function restoreVersion(version: DraftVersion) {
  const id = session.value.packageId;
  if (!id || busy.value || version.id === session.value.currentVersion) return;

  busy.value = true;
  try {
    await writeDraftFiles(id, version.files);
    session.value.draftFiles = version.files;
    session.value.currentVersion = version.id;
    session.value.hasDraft = true;
    session.value.previewEntry = uiEntryOf(version.files);
    session.value.previewPermissions = previewPermissionsFor(version.files);
    session.value.previewSize = manifestSize(version.files);
    session.value.previewScale = manifestScale(version.files);
    previewNonce.value += 1;
    // No note. The marker moves to the message you just clicked, which is
    // where you are looking — and `note` scrolls to the bottom, which would
    // throw you out of the part of the conversation you were reading.
    await save(session.value);
  } catch (error) {
    note(describeDraftError(String(error)));
  } finally {
    busy.value = false;
  }
}

/**
 * One turn's cost, as a line.
 *
 * `cached` is called out separately rather than folded into a total, because it
 * is the number that says whether the caching is working — and it is billed at
 * a tenth, so hiding it inside one figure would make a cheap turn look
 * expensive.
 */
function usageLine(usage: WizardUsage): string {
  const parts = [
    `${formatTokens(freshInput(usage))} in`,
    `${formatTokens(usage.output)} out`,
  ];
  if (usage.cached > 0) parts.push(`${formatTokens(usage.cached)} cached`);
  return parts.join(" · ");
}

/** A stored cost, or nothing — never a fresh calculation at render time. */
function costLabel(cost: WizardCost | null | undefined): string {
  return cost ? `~${formatCost(cost.amount, cost.currency)}` : "";
}

/** Older conversations resolve their saved model name against the catalog. */
function usageBrand(bubble: WizardBubble): string | undefined {
  const credentialType = bubble.modelCredentialType ?? models.value.find(
    (model) => model.id === bubble.model || model.label === bubble.model,
  )?.credentialType;
  return brandMarkFor(credentialType) ? credentialType : undefined;
}

/** Keep the answer's model, token counts and cost together in its tooltip. */
function usageTooltip(bubble: WizardBubble): string {
  return [
    bubble.model,
    bubble.usage ? usageLine(bubble.usage) : "",
    costLabel(bubble.cost),
  ].filter(Boolean).join("\n");
}

/**
 * The conversation's running total.
 *
 * Shown beside the composer, where the next message is about to be sent — the
 * moment the number is worth knowing is the moment before it grows.
 */
const sessionUsage = computed(() => session.value.usage ?? NO_USAGE);
const sessionCost = computed(() => session.value.cost);
const transcriptCopyState = ref<"idle" | "copying" | "copied" | "error">("idle");
let transcriptCopyTimer: ReturnType<typeof setTimeout> | undefined;

/** Feedback belongs to the conversation that was copied. */
function resetTranscriptCopy() {
  clearTimeout(transcriptCopyTimer);
  transcriptCopyState.value = "idle";
}
watch(() => session.value.id, resetTranscriptCopy);
onUnmounted(() => clearTimeout(transcriptCopyTimer));

/** Copy the current transcript and acknowledge only a successful clipboard write. */
async function copyTranscript() {
  if (transcriptCopyState.value === "copying") return;
  resetTranscriptCopy();
  const conversation = session.value;
  transcriptCopyState.value = "copying";
  try {
    await props.model.copyTranscript();
    if (session.value !== conversation) return;
    transcriptCopyState.value = "copied";
    transcriptCopyTimer = setTimeout(resetTranscriptCopy, 1500);
  } catch {
    if (session.value === conversation) transcriptCopyState.value = "error";
  }
}

/** `14:32` — the day is never in question inside one conversation. */
const timeOfDay = (at: number) =>
  new Date(at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

/**
 * The versions still held, by id.
 *
 * A bubble keeps its id forever; the list is capped at five. So a marker is
 * drawn only when its state still exists — an old message offering a button
 * that cannot work is worse than an old message offering nothing.
 */
const versionsById = computed(
  () => new Map((session.value.versions ?? []).map((version) => [version.id, version])),
);

function goBackTo(id: string) {
  const version = versionsById.value.get(id);
  if (version) void restoreVersion(version);
}

/** Newest first, which is the order somebody looks for "the one before this". */
const versionList = computed(() => [...(session.value.versions ?? [])].reverse());

function sourceAuthor(author: DraftAuthor | undefined, clientName?: string | null): DraftAuthor {
  return draftAuthorWithClientName(author, clientName);
}

function sourceIconClient(
  author: DraftAuthor | undefined,
  clientName?: string | null,
): "codex" | "claude" {
  return sourceAuthor(author, clientName) === "claude" ? "claude" : "codex";
}

function versionTitle(version: DraftVersion): string {
  const base =
    version.id === session.value.currentVersion
      ? "This is what is on disk"
      : "Put this version back";
  const author = sourceAuthor(version.author, version.clientName);
  if (!author || author === "wizard") return base;
  return `${base} · ${describeDraftClient(author, version.clientName)}`;
}

/**
 * Put a saved widget on the desk.
 *
 * The same event `saveAndRun` fires, so there is one path that adds a widget
 * and not two that could drift. The host owns instances and layout; an event
 * keeps this extension out of its internals.
 */
function runFromBubble(bubble: WizardBubble) {
  const action = bubble.run;
  if (!action || action.done || busy.value) return;
  action.done = true;
  window.dispatchEvent(
    new CustomEvent("kavibay:run-runtime-widget", { detail: { typeId: action.id } }),
  );
  void save(session.value);
}

/** Only the newest save offers "Add to desk"; older ones are history. */
const latestRunIndex = computed(() => {
  const bubbles = session.value.bubbles;
  for (let at = bubbles.length - 1; at >= 0; at -= 1) if (bubbles[at]!.run) return at;
  return -1;
});

/** Abandon the reply in flight. */
function stop() {
  if (!busy.value) return;
  generation.value += 1;
  busy.value = false;
  firstVersionGeneration.value = false;
  note("Stopped. The answer was discarded.");
}

/**
 * What a write attempt produced.
 *
 * `written` and `problems` are independent: a package can land on disk and
 * still be wrong (that is what the lint is for), and a package that never
 * landed has a problem but nothing to offer or preview.
 */
interface DraftOutcome {
  written: boolean;
  problems: string[];
  /**
   * The write failed for a reason the model cannot do anything about.
   *
   * A name already in use, a quota, a disk that refused — none of those are a
   * flaw in the answer, and asking for a fix spends a turn and comes back with
   * the same package. The person is the one who can act, so they are the one
   * who is told.
   */
  hopeless?: boolean;
}

/**
 * Writes the draft and reports what is wrong with it, rather than saying so.
 *
 * Returning the problems instead of calling `note` is what makes the automatic
 * repair possible — the caller is the one that knows whether there is a retry
 * left, and this is the one place that knows what the problems are.
 */
async function writeDraft(id: string, files: GeneratedFile[]): Promise<DraftOutcome> {
  const storageProblems = storageReadProblems(files);
  if (storageProblems.length) {
    // Reject before previewing: merely running this code could erase saved data.
    session.value.draftError = storageProblems.join("\n");
    return { written: false, problems: storageProblems };
  }
  let summary: DraftSummary;
  try {
    summary = await writeDraftFiles(id, files);
  } catch (error) {
    const code = String(error);
    return {
      written: false,
      problems: [describeDraftError(code)],
      // Everything the draft service refuses outright is about this machine,
      // not about the answer. `draft_exists` is the one that made this obvious:
      // the model was told its perfectly good package had "a problem" and asked
      // to fix a name it had no way to know was taken.
      hopeless: true,
    };
  }

  if (summary.error) {
    session.value.previewEntry = null;
    session.value.draftError = summary.error;
    return { written: false, problems: [describeDraftError(summary.error)] };
  }

  session.value.previewEntry = uiEntryOf(files);
  session.value.draftError = undefined;
  session.value.previewPermissions = previewPermissionsFor(files);
  session.value.draftFiles = files;
  rememberVersion(files, "Generated");
  // Keep whatever size was chosen for this conversation; fall back to what the
  // package itself declares, so reopening shows the widget as it will look.
  session.value.previewSize = session.value.previewSize ?? manifestSize(files);
  session.value.previewScale = session.value.previewScale ?? manifestScale(files);
  session.value.hasDraft = true;
  previewNonce.value += 1;

  // The widget renders either way; these are the ways it can look right and
  // still do nothing, which is the failure nobody gets an error for.
  return { written: true, problems: lintGeneratedFiles(files) };
}

/**
 * Offer to enable a package that wants the network.
 *
 * A widget that declares endpoints cannot reach them while it is a draft:
 * grants live on install records, and a draft has none, so the preview shows
 * "network access has not been granted" no matter what. Offering the grant
 * here — rather than after Save — is what turns that dead end into one click.
 *
 * Called by the turn rather than by the write, so it can be skipped when a
 * repair is about to replace the package this would be describing.
 */
function offerEnable(id: string, files: GeneratedFile[]) {
  if (files.some((file) => file.path === "api.json") && !wizardAutoEnable.value) {
    // Any earlier offer is stale the moment new files land: it described the
    // previous generation's endpoints.
    for (const bubble of session.value.bubbles) {
      if (bubble.enable?.needsSave && !bubble.enable.done) bubble.enable.done = true;
    }
    // Every generation rewrites api.json, and consent is bound to that file, so
    // the grant has to be re-registered even when nothing about it changed.
    // That is not a decision worth re-reading — compare what this asks for with
    // what was already approved, and only call it consent when it differs.
    const lines = consentPreviewFor(files);
    const approved = grantedConsentLines(id);
    const unchanged = approved !== null && JSON.stringify(approved) === JSON.stringify(lines);

    session.value.bubbles.push(
      unchanged
        ? {
            role: "system",
            text: "Save to load this version in the preview — it asks for nothing new.",
            enable: { id, lines, needsSave: true, preApproved: true },
          }
        : {
            role: "system",
            text: "This widget reads from the network. Saving and enabling it grants:",
            enable: { id, lines, needsSave: true },
          },
    );
    scrollDown();
  }
}

/** Files of an already-saved widget, or null when it is not on disk. */
async function readSavedFiles(id: string): Promise<GeneratedFile[] | null> {
  try {
    return await wizard.runtimeReadPackage<GeneratedFile[]>(id);
  } catch {
    return null;
  }
}

/** The manifest's UI entry — the file the preview frame loads. */
function uiEntryOf(files: GeneratedFile[]): string | null {
  /**
   * A contract package has no `ui` block and no entry to name: its document
   * is `index.html` at the package root, always, because the host serves the
   * runtime and the format has exactly three files.
   *
   * Without this the preview finds no entry, which also disables Save — so a
   * correct package looked like it had produced nothing at all.
   */
  if (isContractPackageFiles(files)) {
    return files.some((file) => file.path === "index.html") ? "index.html" : null;
  }

  const manifest = files.find((file) => file.path === "manifest.json");
  if (!manifest) return null;
  try {
    const entry = (JSON.parse(manifest.contents) as { ui?: { entry?: unknown } }).ui?.entry;
    return typeof entry === "string" && entry.length > 0 ? entry : null;
  } catch {
    return null;
  }
}

// --- editing an existing widget --------------------------------------------

/**
 * Open a widget for editing, whoever it belongs to.
 *
 * One path for all three cases the sidebar can show — a saved widget with no
 * pending changes, a draft this Wizard left behind, a draft an MCP client
 * created — because they are the same act: put the widget into the draft
 * workspace and edit it there.
 *
 * It used to read the *installed* files straight into the session instead. That
 * made editing a saved widget the only path that never touched the draft
 * service, with two consequences. An MCP client could not see the work at all
 * until the first hand edit happened to create a draft. And when a draft was
 * already there, this read the older saved files, took the existing draft's
 * revision on the first write — a revision that validates — and published over
 * somebody's unsaved widget without a conflict ever being detected.
 *
 * `draftOpen` answers both questions in one call, which is also why the check
 * is not done here: between "is there a draft?" and "then check one out" is
 * exactly the window in which the other client creates one.
 */
async function openWidget(id: string, conversationId: string | null = null) {
  if (!id || busy.value) return;
  composing.value = false;
  busy.value = true;
  try {
    const opened = await wizard.draftOpen<DraftOpen>(id);
    const snapshot = opened.snapshot;
    const author = draftAuthorOf(snapshot.lastWriter ?? null, snapshot.lastClient);
    const clientName = snapshot.lastClientName ?? null;
    await save(session.value);

    /**
     * Continue the conversation this widget already has.
     *
     * Every open used to start a fresh one, so editing the same widget five
     * times left five identically named rows in the sidebar and four transcripts
     * nobody would ever find again. The history of a widget is one history.
     */
    const resumed = conversationId ? await load(conversationId) : null;
    if (resumed) {
      resumed.model = defaultWizardModel(models.value, resumed.model);
      session.value = resumed;
    } else {
      start();
    }

    draftConflict.value = null;
    session.value.widgetName = draftDisplayName(id, snapshot.files);
    session.value.packageId = id;
    // Names the widget that is *installed* right now, so Save retires it rather
    // than leaving a second copy behind after a rename. A draft that was never
    // kept has nothing to retire.
    session.value.editing = myWidgets.value.some((widget) => widget.id === id) ? id : "";
    session.value.draftFiles = snapshot.files;
    session.value.draftRevision = snapshot.revision;
    session.value.draftError = snapshot.error ?? undefined;
    session.value.hasDraft = true;
    session.value.previewSize = manifestSize(snapshot.files);
    session.value.previewScale = manifestScale(snapshot.files);
    session.value.previewEntry = uiEntryOf(snapshot.files);
    session.value.previewPermissions = previewPermissionsFor(snapshot.files);
    // An already-enabled widget opened for editing holds real grants; without
    // this its preview would refuse its own network calls while the same widget
    // works on the desk.
    adoptGrantedPermissions(id);
    savedApiText.value =
      (await readSavedFiles(id))?.find((file) => file.path === "api.json")?.contents ?? null;
    // The baseline. Without it the first generation has nothing to be compared
    // against, and "put it back the way it was" — the most likely thing to want
    // when editing a widget that already works — has no entry to point at.
    rememberVersion(
      snapshot.files,
      opened.existing
        ? author === "wizard"
          ? "Opened draft"
          : `Opened ${describeDraftAuthor(author)} draft`
        : "Opened",
      opened.existing && author !== "wizard" ? author : null,
      opened.existing && author !== "wizard" ? clientName : null,
    );
    appendNote(session.value.bubbles, {
      role: "system",
      opened: true,
      text: describeDraftOpen(id, opened.existing, author),
      author: opened.existing && author !== "wizard" ? author : null,
      clientName: opened.existing && author !== "wizard" ? clientName : null,
      version: session.value.currentVersion,
    });
    previewNonce.value += 1;
    await save(session.value);
    await refreshDrafts();
    scrollDown();
  } catch (error) {
    note(describeDraftError(String(error)));
  } finally {
    busy.value = false;
  }
}

/** Who wrote the version this conversation is being asked about. */
const conflictAuthor = computed(() =>
  describeDraftClient(
    draftAuthorOf(
      draftConflict.value?.external?.lastWriter ?? null,
      draftConflict.value?.external?.lastClient,
    ),
    draftConflict.value?.external?.lastClientName,
  ),
);

/** Reload is an explicit choice: it may discard a local edit, never silently. */
async function reloadMcpVersion(): Promise<void> {
  const conflict = draftConflict.value;
  if (!conflict || busy.value) return;
  busy.value = true;
  try {
    const latest = await readDraftSnapshot(conflict.id);
    if (latest) {
      const author = draftAuthorOf(latest.lastWriter ?? null, latest.lastClient);
      await applyExternalSnapshot(
        latest,
        `Reloaded ${describeDraftClient(author, latest.lastClientName)}'s version`,
      );
    } else {
      session.value.draftFiles = null;
      session.value.draftRevision = undefined;
      session.value.draftError = undefined;
      session.value.knownFiles = undefined;
      session.value.hasDraft = false;
      session.value.previewEntry = null;
      session.value.previewPermissions = [];
      session.value.previewSize = null;
      session.value.previewScale = null;
      session.value.bubbles.push({
        role: "system",
        text: "Reloaded the external version: the draft was removed.",
      });
      await save(session.value);
      scrollDown();
    }
    draftConflict.value = null;
  } catch (error) {
    note(describeDraftError(String(error)));
  } finally {
    busy.value = false;
  }
}

/** Keep mine is a deliberate optimistic overwrite; a newer MCP revision asks again. */
async function keepMyVersion(): Promise<void> {
  const conflict = draftConflict.value;
  const id = session.value.packageId;
  if (!conflict || !id || conflict.id !== id || busy.value) return;
  busy.value = true;
  try {
    const summary = await writeDraftFiles(
      id,
      conflict.localFiles,
      keepMineExpectedRevision(conflict),
    );
    session.value.draftFiles = conflict.localFiles;
    session.value.draftRevision = summary.revision;
    session.value.draftError = summary.error ?? undefined;
    session.value.knownFiles = undefined;
    session.value.hasDraft = true;
    session.value.previewEntry = uiEntryOf(conflict.localFiles);
    session.value.previewPermissions = previewPermissionsFor(conflict.localFiles);
    session.value.previewSize = manifestSize(conflict.localFiles) ?? session.value.previewSize;
    session.value.previewScale = manifestScale(conflict.localFiles) ?? session.value.previewScale;
    rememberVersion(conflict.localFiles, "Kept my version");
    session.value.bubbles.push({
      role: "system",
      text: "Kept my version",
      version: session.value.currentVersion,
    });
    previewNonce.value += 1;
    draftConflict.value = null;
    await save(session.value);
    scrollDown();
  } catch (error) {
    const message = String(error);
    if (message.includes("draft_conflict:")) {
      const latest = await readDraftSnapshot(id);
      draftConflict.value = queueDraftConflict(conflict, {
        ...conflict,
        external: latest,
        externalRevision: latest?.revision ?? null,
      });
      note("The MCP draft changed again. Choose a version before writing.");
    } else {
      note(describeDraftError(message));
    }
  } finally {
    busy.value = false;
  }
}

// --- save / export ---------------------------------------------------------

/**
 * Move the draft into the custom root and turn it on.
 *
 * A widget that wants network access or a credential is kept but *not* enabled:
 * those are what the consent screen exists to show, and "the person asked for
 * this widget" is not the same as "the person saw what it may reach".
 */
/**
 * Write the current files and move them into the custom root.
 *
 * Shared by Save and by the consent bubble's button, which has to save before
 * it can grant anything: a draft has no install record, so there is nothing for
 * a grant to attach to until the package exists. Returns false when it reported
 * its own problem.
 */
async function promoteDraft(id: string): Promise<boolean> {
  await previewSettingsWrite;
  // The size the preview was left at is the size the widget should open at.
  // Written back before promoting, so size and scale are part of the package
  // rather than something the person has to set again on the desk.
  const size = session.value.previewSize;
  const scale = session.value.previewScale;
  // Fall back to disk. A conversation stored before the wizard kept its file
  // set has none in memory, and re-reading the saved package is cheaper than
  // telling someone their resize does not count.
  const files = session.value.draftFiles ?? (await readSavedFiles(id));
  if (!files) {
    note("Could not read this widget's files, so nothing was saved.");
    return false;
  }

  let sized = size ? withDefaultSize(files, size) : files;
  if (scale !== null) sized = withDefaultScale(sized, scale);
  // Written whenever there is no draft on disk: after a previous save there
  // is none, so a resize alone would have nothing to promote.
  if (sized !== files || !session.value.hasDraft) {
    await writeDraftFiles(id, sized);
    session.value.draftFiles = sized;
    // Patched in place, not appended: saving rewrites `ui.defaultSize` to
    // whatever the preview was left at, which changes the bytes without being
    // a step anybody took. An entry per save would push the version that
    // matters off a five-long list.
    session.value.versions = updateLiveVersion(
      session.value.versions,
      session.value.currentVersion,
      sized,
    );
    session.value.hasDraft = true;
  }

  /**
   * The widget this draft came from, when it is not the one being installed.
   *
   * Only this conversation knows the two are the same widget: the draft moved
   * to its new name and nothing on disk still connects them. Without it the
   * rename installs a second copy and leaves the original on the desk — still
   * holding the grants, no longer the one anybody is editing.
   */
  const replaces =
    session.value.editing && session.value.editing !== id ? session.value.editing : null;
  await wizard.draftPromote<string>(id, replaces);
  if (replaces) note(`"${replaces}" is now "${id}".`);
  session.value.draftRevision = undefined;
  session.value.draftError = undefined;
  return true;
}

async function keep(runAfterSave = false) {
  const id = session.value.packageId;
  if (!id || busy.value) return;
  busy.value = true;
  try {
    if (!(await promoteDraft(id))) return;
    const row = (await rescan()).find((scanned) => scanned.id === id);
    if (row?.format === "contract") {
      /**
       * Save is where a contract package is asked what it may read.
       *
       * Not the preview: what a draft requests changes with every regeneration,
       * so a dialog there would come back on each iteration, and a dialog that
       * keeps coming back is one that gets clicked away — which is finding 20's
       * argument turned against itself. Save is the moment the thing stops
       * being a draft, and it is the same moment Settings asks at.
       *
       * The consent lines above cannot carry this question: they describe
       * capabilities from a fixed catalogue, and this is a list of provider
       * queries with a tick each.
       */
      /**
       * ...and asked *again* on every save, which was the same mistake one
       * level up. Regenerating a widget rewrites its files but not what it
       * reads, so iterating on the wording of a tile produced an identical
       * dialog every time — and a dialog that always returns unchanged is one
       * people learn to dismiss unread. The grant survives a regeneration (it
       * lives on the install record, not in the package), so when nothing new
       * is asked there is nothing left to decide and the existing grant is
       * simply re-applied.
       *
       * Only identical-or-narrower is silent. One new query and the dialog
       * comes back, with the already-approved boxes ticked so the empty one is
       * the question.
       */
      const request = approvalRequestFor(id);
      const granted = approvedGrantFor(id);
      if (request && askedNothingNew(request, granted)) {
        await applyContractGrant(id, granted!, runAfterSave);
      } else if (request && wizardAutoEnable.value && canAutoApprove(request)) {
        /**
         * The same bypass the runtime path has always honoured.
         *
         * It was armed and did nothing here, so a contract widget asked on
         * every save while a runtime one did not — one switch with two
         * meanings depending on which format the answer happened to be. What
         * is granted is exactly what the package asked for; see
         * `autoApprovedGrant`.
         */
        await applyContractGrant(
          id,
          autoApprovedGrant(request),
          runAfterSave,
          " It was granted what it asked for (Developer Extensions).",
        );
      } else {
        session.value.bubbles.push({
          role: "system",
          text: `Kept "${id}". Choose what it may read:`,
          approve: { id, ...(runAfterSave ? { run: true } : {}) },
        });
      }
      scrollDown();
    } else if (row && needsReviewBeforeEnable(row) && !wizardAutoEnable.value) {
      // The list travels with the note rather than sending someone to Settings
      // to read it. Same text, same grant — only the walk is gone.
      session.value.bubbles.push({
        role: "system",
        text: `Kept "${id}". Enabling it grants:`,
        enable: { id, lines: consentLinesFor(row) },
      });
      scrollDown();
    } else if (await enablePackage(id)) {
      adoptGrantedPermissions(id);
      // Enabling normally grants nothing worth announcing. When the bypass is
      // what made it possible, say so: the grant happened either way, and a
      // silent one is the part that would be indefensible.
      const bypassed = row !== undefined && needsReviewBeforeEnable(row);
      const how = bypassed ? " Consent was skipped (Developer Extensions)." : "";
      if (runAfterSave) {
        // The host owns instances and layout. An event keeps this extension
        // from reaching into host internals while still allowing a direct run.
        window.dispatchEvent(
          new CustomEvent("kavibay:run-runtime-widget", { detail: { typeId: id } }),
        );
        note(`"${id}" is on and opening on the desk.${how}`, "success");
      } else {
        session.value.bubbles.push({
          role: "system",
          tone: "success",
          text: `Saved "${id}".${how}`,
          run: { id },
        });
        scrollDown();
      }
    } else {
      note(`Kept "${id}", but it could not be enabled. See Settings -> Extensions.`);
    }
    session.value.hasDraft = false;
    session.value.draftRevision = undefined;
    session.value.draftError = undefined;
    session.value.editing = id;
    // Promotion installed exactly these bytes, so the declaration the grant now
    // belongs to is the one in the session.
    savedApiText.value =
      (session.value.draftFiles ?? []).find((file) => file.path === "api.json")?.contents ?? null;
    await Promise.all([save(session.value), loadMyWidgets(), refreshDrafts()]);
  } catch (error) {
    note(describeDraftError(String(error)));
  } finally {
    busy.value = false;
  }
}

let saveShortcutActive = false;

/** Include the host's focusable card/shell, which sits outside the Wizard root. */
function saveShortcutScope(): HTMLElement | null {
  const root = wizEl.value;
  return root?.closest<HTMLElement>(".widget-card, .inline-widget-shell") ?? root;
}

/** Retain ownership when a busy editor loses focus, but relinquish it on other interactions. */
function onSaveShortcutInteraction(event: Event) {
  const target = event.target;
  if (event.type === "focusin" && (target === document.body || target === document.documentElement)) return;
  saveShortcutActive = target instanceof Node && !!saveShortcutScope()?.contains(target);
}

/** Save from the active Wizard, including edits that have not blurred yet. */
async function onSaveKeydown(event: KeyboardEvent) {
  if (
    event.defaultPrevented ||
    !(event.metaKey || event.ctrlKey) ||
    event.altKey || event.shiftKey || event.isComposing ||
    event.key.toLowerCase() !== "s"
  ) return;

  const root = wizEl.value;
  if (!root || root.getClientRects().length === 0) return;
  const target = event.target;
  const focusOnPage = target === document.body || target === document.documentElement;
  if (!(target instanceof Node && saveShortcutScope()?.contains(target)) &&
      !(focusOnPage && saveShortcutActive)) return;

  event.preventDefault();
  event.stopPropagation();
  if (event.repeat || sharing.value || busy.value || (!canSave.value && !draftEditorDirty.value)) return;

  const targetSession = session.value;
  if (draftEditorDirty.value) await applyFile();
  // A failed edit must not silently save the previous file contents.
  if (session.value !== targetSession || draftEditorDirty.value || !canSave.value) return;
  await keep();
}

onMounted(() => {
  window.addEventListener("pointerdown", onSaveShortcutInteraction, true);
  window.addEventListener("focusin", onSaveShortcutInteraction, true);
  window.addEventListener("keydown", onSaveKeydown, true);
});
onUnmounted(() => {
  window.removeEventListener("pointerdown", onSaveShortcutInteraction, true);
  window.removeEventListener("focusin", onSaveShortcutInteraction, true);
  window.removeEventListener("keydown", onSaveKeydown, true);
});

/** Save the package and immediately add/focus its enabled runtime widget. */
function saveAndRun() {
  return keep(true);
}

/**
 * Write this widget to a zip somewhere outside the app.
 *
 * The whole package, not the file on screen: a widget is a folder, and a single
 * `.vue` handed to somebody is a file they cannot run. Where it goes is asked
 * for by the host's own save dialog — this side names the widget and nothing
 * else.
 *
 * Which copy travels is the host's answer, not a question asked here. It sends
 * the draft when one exists, because that is what the preview beside this
 * button is showing, and it says which it sent so the reply cannot claim the
 * saved widget while holding the draft.
 */
async function exportWidget() {
  const id = session.value.packageId;
  if (!id || busy.value) return;
  busy.value = true;
  shareFeedback.value = "";
  try {
    const report = await wizard.exportPackage(id);
    // A dismissed dialog is an answer, not a failure. Saying anything here
    // would be the app remarking on a decision that was already made.
    if (!report) return;
    const what = report.source === "draft" ? `the unsaved draft of "${id}"` : `"${id}"`;
    note(`Exported ${what} — ${report.files} files — to ${report.path}`, "success");
    shareFeedback.value = "Widget exported.";
  } catch (error) {
    shareFeedback.value = describeExportError(String(error));
    note(shareFeedback.value);
  } finally {
    busy.value = false;
  }
}

async function loadProviders() {
  try {
    wizardAutoEnable.value = await wizard.developerConsentBypass();
    developerExtensions.value = await wizard.developerExtensionsEnabled();
    providerSchemas.value = await wizard.providers<WizardProviderSchema[]>();
    const states = await Promise.all(
      providerSchemas.value.map(async (schema) => [
        schema.id,
        (await wizard.providerStatus<{ state?: string }>(schema.id)).state === "connected",
      ] as const),
    );
    providerConnected.value = new Map(states);
  } catch {
    providerSchemas.value = [];
    providerConnected.value = new Map();
  }
}

async function rescan(): Promise<ScannedRuntimeExtension[]> {
  const rows = await wizard.runtimeScan<ScannedRuntimeExtension[]>();
  const records = await wizard.runtimeInstalls<RuntimeInstallRecord[]>();
  scanned.value = Array.isArray(rows) ? rows : [];
  installs.value = Array.isArray(records) ? records : [];
  return scanned.value;
}

/**
 * Whether the preview may reach one credential type.
 *
 * The rule is the grant, not the draft. A draft of a widget that was never kept
 * has no install record and reaches nothing, exactly as before — but a draft of
 * an installed, granted widget is that widget being edited, and refusing it
 * meant the one endpoint the widget exists for could not be tried until after
 * it had been saved untested. Rust decides; this only avoids drawing a button
 * that is going to be refused.
 */
function credentialReachable(credentialType: string): boolean {
  const id = session.value.packageId;
  if (!id) return false;
  const record = installs.value.find((install) => install.id === id);
  return Boolean(record?.grantedCredentials?.includes(credentialType));
}

/**
 * The `api.json` of the installed widget, as it was when this one was opened.
 *
 * Rust compares hashes; this compares the bytes they are hashes of, which is
 * the same question without a digest in a sandbox that has no synchronous one.
 * Read once per open rather than per render: it is a file on disk that only
 * Save changes.
 */
const savedApiText = ref<string | null>(null);

/**
 * Whether the draft still declares what the grant was given for.
 *
 * A regenerated `api.json` is a different set of requests, so the credential
 * drops out until the endpoints have been reviewed again. Saying so beside the
 * button beats meeting it as a `consent_stale` code after pressing it.
 */
const consentStillMatches = computed(() => {
  const declaration = (session.value.draftFiles ?? []).find((file) => file.path === "api.json");
  return declaration?.contents === savedApiText.value;
});

async function enablePackage(
  id: string,
  contractGrant?: { approved: string[]; actions: Record<string, string[]> },
): Promise<boolean> {
  const row = scanned.value.find((item) => item.id === id);
  try {
    await wizard.runtimeSetEnabled(id, true, row?.permissions ?? [], contractGrant);
    await rescan();
    return true;
  } catch {
    return false;
  }
}
</script>

<template>
  <div
    ref="wizEl"
    class="wiz"
    :class="{ 'wiz--sidebar-collapsed': sidebarHidden }"
    :style="{ gridTemplateColumns: gridColumns }"
  >
    <!-- Left: what you have already made or asked -->
    <aside v-show="!tooNarrow" class="wiz-side wiz-c1">
      <div class="wiz-side-top">
        <button type="button" class="wiz-new" :disabled="busy" @click="newConversation">
          <SquarePenIcon :size="14" />
          <span>New project</span>
        </button>
        <button
          type="button"
          class="wiz-side-toggle"
          aria-label="Hide sidebar"
          v-tip="'Hide sidebar'"
          @click="toggleSidebar"
        >
          <PanelLeftIcon :size="15" />
        </button>
      </div>

      <p class="wiz-side-heading">Projects</p>

      <div class="wiz-side-sections">
        <!--
          One row per project: a widget and every conversation about it.

          It was three groups — saved widgets, conversations, "external
          drafts" — which are three places a widget is stored rather than three
          kinds of thing, so one widget could occupy all three rows at once with
          different files behind each. A project is the unit somebody actually
          works in: they do not open "a draft", they go back to the water
          tracker.
        -->
        <div class="wiz-side-group wiz-side-group--all">
          <div class="wiz-side-group-body">
            <div
              v-for="row in projectRows"
              :key="row.key"
              :data-project-key="row.key"
              class="wiz-side-item wiz-side-item--stacked"
              :class="{ 'wiz-side-item--dragging': dragging === row.key }"
              @mouseleave="pendingDelete === row.key && (pendingDelete = null)"
            >
              <!--
                The highlight sits on the line, not on the project block: on the
                block it tinted the conversations inside it too, so an open
                project and its contents were one grey slab. It moves down to the
                conversation once that has a row of its own, so only one row on
                screen ever reads as open.
              -->
              <div
                class="wiz-side-line"
                :class="{
                  'wiz-side-sel': isActiveRow(row) && !showsActiveConversation(row),
                  'wiz-side-line--bare': !row.packageId,
                  'wiz-side-line--armed': pendingDelete === row.key,
                }"
              >
                <!--
                  One control for the project.

                  Clicking it opens the project and unfolds it; clicking the one
                  that is already open just folds it back. A separate twisty was
                  a second thing to aim at for a question the row can answer on
                  its own, and it put a column of arrows down the left edge where
                  the names should start.
                -->
                <button
                  type="button"
                  class="wiz-side-row"
                  :disabled="busy"
                  :aria-expanded="isExpanded(row)"
                  @click="openRow(row)"
                  @keydown.up.alt.prevent="reorder(row.key, -1)"
                  @keydown.down.alt.prevent="reorder(row.key, 1)"
                >
                  <span class="wiz-side-head">
                    <!--
                      One bit, before the name: is this in the palette yet.

                      It replaces a whole second line per row — what changed,
                      who changed it, how long ago — which answered questions
                      nobody asks while scanning a list and cost every row twice
                      its height to do it. The rest is not gone, it is on this
                      dot's tooltip.
                    -->
                    <span
                      class="wiz-side-dot"
                      :class="
                        row.draft && row.saved
                          ? 'wiz-side-dot--changed'
                          : projectIsLive(row)
                            ? 'wiz-side-dot--live'
                            : 'wiz-side-dot--draft'
                      "
                      v-tip="describeProjectStatus(row)"
                      role="img"
                      :aria-label="describeProjectStatus(row)"
                    ></span>
                    <span class="wiz-side-name">
                      <span
                        v-if="row.invalid"
                        class="wiz-side-warn"
                        v-tip="'This draft does not pass validation'"
                        aria-label="does not validate"
                      >!</span>
                      {{ row.title }}
                    </span>
                    <span
                      v-if="widgetPresence(row.packageId)"
                      class="wiz-side-presence"
                      :class="{ 'wiz-side-presence--active': widgetPresence(row.packageId)?.active }"
                      v-tip="presenceTitle(widgetPresence(row.packageId))"
                      :aria-label="presenceTitle(widgetPresence(row.packageId))"
                    >
                      <McpClientMark
                        v-if="presenceAuthor(widgetPresence(row.packageId)) === 'codex' || presenceAuthor(widgetPresence(row.packageId)) === 'claude'"
                        :client="presenceMark(widgetPresence(row.packageId))"
                        :size="12"
                      />
                      <span v-else class="wiz-side-presence-dot" aria-hidden="true"></span>
                    </span>
                    <span
                      v-else-if="row.draft && row.author !== 'wizard'"
                      class="wiz-side-presence"
                      v-tip="projectDraftTitle(row)"
                      :aria-label="projectDraftTitle(row)"
                    >
                      <McpClientMark
                        v-if="projectDraftMark(row)"
                        :client="projectDraftMark(row)!"
                        :size="12"
                      />
                      <span v-else class="wiz-side-presence-dot" aria-hidden="true"></span>
                    </span>
                    <!--
                      Two projects can carry one display name and are still two
                      folders, so the one case that needs it names its folder.
                      Only that case: everywhere else it repeats the name.
                    -->
                    <em v-if="row.ambiguous" class="wiz-side-id">{{ row.packageId }}</em>
                    <!--
                      After the name, not before it. On the left it is a column
                      of arrows the eye has to cross to reach the first letter of
                      every row; after the name it is where the name ends, which
                      is where somebody looking for "is there more in here" looks.
                    -->
                    <span
                      class="wiz-side-caret"
                      :class="{ 'wiz-side-caret--open': isExpanded(row) }"
                      aria-hidden="true"
                    >
                      <svg viewBox="0 0 12 12" width="9" height="9">
                        <path
                          d="M4.5 2.5 L8 6 L4.5 9.5"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="1.7"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        />
                      </svg>
                    </span>
                    <span
                      v-if="busy && isActiveRow(row) && !showsActiveConversation(row)"
                      class="wiz-side-spinner"
                      role="status"
                      aria-label="Working"
                    ></span>
                  </span>
                </button>
                <!--
                  Laid over the end of the row instead of beside it. Beside it,
                  the hidden buttons kept their width at rest and every name was
                  cut off after a few letters next to an empty stretch of row.
                -->
                <span class="wiz-side-actions">
                  <!--
                    Start a conversation in this project without opening anything
                    first. Only where there is a project to start one in: a row
                    that is itself nothing but a conversation has no second one to
                    offer, and a + there would make a new project under the wrong
                    name.
                  -->
                  <button
                    v-if="row.packageId"
                    type="button"
                    class="wiz-side-add"
                    v-tip="'New conversation in this project'"
                    aria-label="New conversation"
                    :disabled="busy"
                    @click.stop="newConversationIn(row)"
                  >+</button>
                  <!--
                    Pointer events, not HTML5 drag-and-drop.

                    The webview this runs in hands OS-level drag to the host
                    window, and in-page `dragstart` is not reliably delivered — a
                    handle that works everywhere except in the app it is for is
                    worse than no handle. Alt+arrows on the row do the same thing
                    without a pointer at all.
                  -->
                  <span
                    class="wiz-side-grip"
                    v-tip="'Drag to reorder — or Alt+↑ / Alt+↓ on the row'"
                    aria-hidden="true"
                    @pointerdown="startReorder(row.key, $event)"
                  >⠿</span>
                  <button
                    type="button"
                    class="wiz-side-del"
                    :class="{ 'wiz-side-del--armed': pendingDelete === row.key }"
                    v-tip="
                      pendingDelete === row.key ? 'Click again — there is no undo' : rowDeleteTip(row)
                    "
                    :disabled="busy"
                    @click="deleteRow(row)"
                  >
                    {{ pendingDelete === row.key ? "Sure?" : "×" }}
                  </button>
                </span>
              </div>

              <div v-if="isExpanded(row)" class="wiz-side-history">
                <div
                  v-for="conversation in row.conversationIds"
                  :key="conversation"
                  class="wiz-side-item"
                  :class="{ 'wiz-side-sel': conversation === session.id }"
                >
                  <!--
                    What was asked, not what the widget is called. Every
                    conversation in a project carries the project's name, so
                    six of them were six rows reading "Raumklima" — a list that
                    cannot be told apart is a list nobody can choose from.
                  -->
                  <button
                    type="button"
                    class="wiz-side-row wiz-side-row--older"
                    :disabled="busy"
                    :title="conversationTitleFor(conversation)"
                    @click="openConversation(conversation)"
                  >
                    <span class="wiz-side-name">{{ conversationTitleFor(conversation) }}</span>
                    <span
                      v-if="busy && conversation === session.id"
                      class="wiz-side-spinner"
                      role="status"
                      aria-label="Working"
                    ></span>
                    <small v-else class="wiz-side-when">{{ conversationAgeFor(conversation) }}</small>
                  </button>
                  <span class="wiz-side-actions">
                    <button
                      type="button"
                      class="wiz-side-del"
                      v-tip="'Delete this conversation'"
                      :disabled="busy"
                      @click="deleteConversation(conversation)"
                    >
                      ×
                    </button>
                  </span>
                </div>
                <p v-if="!row.conversationIds.length" class="wiz-hint">
                  No conversation yet — press + to start one.
                </p>
              </div>
            </div>
            <p v-if="!projectRows.length" class="wiz-hint">Nothing yet.</p>
          </div>
        </div>
      </div>
      <WizardMcpHelp
        v-if="!sidebarHidden && !tooNarrow"
        @open-settings="wizard.openSettings('mcp')"
      />
    </aside>

    <!-- Middle: name, chat, model -->
    <div
      v-show="!tooNarrow"
      class="wiz-grip wiz-c2"
      :class="{ 'wiz-c2--sidebar-collapsed': sidebarHidden }"
      role="separator"
      aria-orientation="vertical"
      aria-label="Sidebar width"
      tabindex="0"
      @pointerdown.prevent="startDrag('side', $event)"
      @keydown.left.prevent="nudge('side', -1)"
      @keydown.right.prevent="nudge('side', 1)"
    >
      <!--
        In the divider's track because that is the one place left on screen when
        the sidebar is folded: the header above the conversation is hidden while
        composing, which is exactly when the sidebar is tucked away.
      -->
      <button
        v-if="sidebarHidden"
        type="button"
        class="wiz-side-expand"
        aria-label="Show sidebar"
        v-tip="'Show sidebar'"
        @pointerdown.stop
        @keydown.stop
        @click.stop="toggleSidebar"
      >
        <PanelLeftIcon :size="15" />
      </button>
    </div>

    <section class="wiz-main wiz-c3">
      <!--
        Name and tabs on one line.

        They were three rows of chrome above a column that is already narrow,
        and none of them is content. The name was a filled box the width of the
        panel, which reads as a form waiting to be filled in rather than as the
        title of the thing on screen — so it is plain text now, and only shows
        it can be typed in when the pointer is on it.
      -->
      <!--
        Hidden while composing. The name field names a package that does not
        exist, the tab switch offers Files that are not there, and both sit
        above the one thing somebody who just pressed "New Widget" came to do.
        It returns by itself the moment there is a package to describe.
      -->
      <header v-if="!composing" class="wiz-head">
        <input
          v-model="session.widgetName"
          class="wiz-name-input"
          placeholder="Name your widget…"
          :disabled="busy"
          @change="onNameChanged"
        />
        <!--
          Conversation or code, never both. They are two readings of the same
          widget, and this column is not wide enough to be honest about either
          while showing half of the other. The preview is not in this choice — it
          is what you are reading them against.
        -->
        <div
          class="wiz-tabs"
          role="tablist"
          aria-label="Show"
          @keydown.left.prevent="stepMiddleTab(-1)"
          @keydown.right.prevent="stepMiddleTab(1)"
        >
          <button
            v-for="tab in middleTabs"
            :key="tab.id"
            type="button"
            role="tab"
            class="wiz-tab"
            :class="{ 'wiz-tab--on': middleTab === tab.id }"
            :aria-selected="middleTab === tab.id"
            :aria-label="tab.label"
            :tabindex="middleTab === tab.id ? 0 : -1"
            :disabled="tab.disabled"
            v-tip="tab.label"
            @click="middleTab = tab.id"
          >
            <component :is="tab.icon" :size="13" :stroke-width="2" />
            <span class="wiz-tab-label">{{ tab.label }}</span>
            <span v-if="tab.count" class="wiz-tab-count">{{ tab.count }}</span>
          </button>
        </div>
      </header>

      <div
        v-if="activePresence"
        class="wiz-presence"
        :class="{ 'wiz-presence--active': activePresence.active }"
        role="status"
        :title="presenceTitle(activePresence)"
      >
        <McpClientMark
          v-if="presenceAuthor(activePresence) === 'codex' || presenceAuthor(activePresence) === 'claude'"
          :client="presenceMark(activePresence)"
          :size="14"
          class="wiz-presence-mark"
        />
        <span v-else class="wiz-presence-dot" aria-hidden="true"></span>
        <span>{{ describeDraftPresence(activePresence) }}</span>
      </div>

      <!--
        Named after whoever actually wrote it. "Changed via MCP" was hard-coded,
        so a second Wizard card editing the same draft accused a client that had
        never run — and the byline is the whole reason this banner is readable
        rather than alarming.
      -->
      <div v-if="draftConflict" class="wiz-mcp-conflict" role="alert">
        <strong>This draft was changed by {{ conflictAuthor }}</strong>
        <p v-if="draftConflict.external">
          That version is newer than the one on screen. Choose which complete
          file set to keep; Kavibay will not merge or overwrite either
          automatically.
        </p>
        <p v-else>
          The draft was removed. Reload drops it here too; Keep my version
          recreates it explicitly.
        </p>
        <div class="wiz-mcp-conflict-actions">
          <button type="button" :disabled="busy" @click="reloadMcpVersion">
            Reload their version
          </button>
          <button type="button" :disabled="busy" @click="keepMyVersion">
            Keep my version
          </button>
        </div>
      </div>

      <p v-if="session.draftError" class="wiz-draft-error" role="alert">
        Draft validation: {{ describeDraftError(session.draftError) }}
      </p>

      <!--
        Still shown when *some* platform has a key but the picked model's does
        not — the gate below only covers having no key at all.
      -->
      <p v-if="hasAnyKey && activeModel && !activeModel.configured" class="wiz-setup">
        No API key for {{ activeModel.label }} yet.
        <button
          type="button"
          class="wiz-link"
          @click="wizard.openSettings('ai', activeModel.provider)"
        >
          Add key
        </button>
      </p>

      <!--
        Every file of the package, not just the manifest. The one that explains
        a failure is rarely the one somebody guessed to expose: an evening went
        into a broken `api.json` that could only be read from `%APPDATA%`.
      -->
      <div v-show="middleTab === 'files'" class="wiz-filesview">
        <!--
          Every generation rewrites the whole package, so the version before
          this one exists nowhere else — not on disk, not usably in the
          transcript, and not with the model, which reasons from the files it
          was last sent. This strip is the only way back.
        -->
        <div v-if="versionList.length > 1" class="wiz-versions">
          <button
            v-for="version in versionList"
            :key="version.id"
            type="button"
            class="wiz-version"
            :disabled="busy || version.id === session.currentVersion"
            :title="versionTitle(version)"
            @click="restoreVersion(version)"
          >
            {{ version.label }}
            <McpClientMark
              v-if="sourceAuthor(version.author, version.clientName) === 'codex' || sourceAuthor(version.author, version.clientName) === 'claude'"
              :client="sourceIconClient(version.author, version.clientName)"
              :size="12"
              class="wiz-version-source"
              :title="describeDraftClient(sourceAuthor(version.author, version.clientName), version.clientName)"
            />
            <span class="wiz-version-at">{{ timeOfDay(version.at) }}</span>
          </button>
        </div>

        <!--
          One panel, like an editor's: the tree on the left, the open file on
          the right under its path. A path such as `ui/index.html` is shown as
          the folder it is in, so the list reads as the package's layout rather
          than as a column of strings to parse.
        -->
        <div class="wiz-files">
        <nav v-if="fileList.length" class="wiz-filetree" aria-label="Files">
          <p class="wiz-filetree-heading">Files</p>
          <ul class="wiz-filelist">
            <li v-for="row in fileRows" :key="row.key">
              <span
                v-if="row.kind === 'folder'"
                class="wiz-filerow wiz-filerow--folder"
                :style="{ '--depth': row.depth }"
              >
                <FolderIcon :size="13" class="wiz-fileicon wiz-fileicon--folder" />
                <span class="wiz-filename">{{ row.name }}</span>
              </span>
              <button
                v-else
                type="button"
                class="wiz-filerow wiz-filebtn"
                :class="{ 'wiz-filebtn--on': row.path === openFile }"
                :style="{ '--depth': row.depth }"
                :title="row.path"
                @click="openFile = row.path"
              >
                <component
                  :is="FILE_ICONS[fileKind(row.path)]"
                  :size="13"
                  class="wiz-fileicon"
                  :class="`wiz-fileicon--${fileKind(row.path)}`"
                />
                <span class="wiz-filename">{{ row.name }}</span>
              </button>
            </li>
          </ul>
        </nav>
        <div class="wiz-fileedit">
          <div v-if="fileList.length" class="wiz-filepath">
            <component
              :is="FILE_ICONS[fileKind(openFile)]"
              :size="13"
              class="wiz-fileicon"
              :class="`wiz-fileicon--${fileKind(openFile)}`"
            />
            <template v-for="(folder, index) in openFileFolders" :key="index">
              <span class="wiz-filepath-dir">{{ folder }}</span>
              <span class="wiz-filepath-dir" aria-hidden="true">/</span>
            </template>
            <span class="wiz-filepath-name">{{ openFileName }}</span>
          </div>
          <p v-if="editInvalidatesConsent" class="wiz-filenote">
            Editing this re-opens the endpoint review before the widget may use
            the network again.
          </p>
          <!--
            Two layers, exactly aligned: a `<pre>` holding the colour and a
            textarea over it whose text is transparent and whose caret is not.
            The textarea stays a real textarea — undo, selection, spellcheck
            settings and IME all keep working, which is what every editor built
            out of contenteditable has to reimplement badly.

            The whitespace here is load-bearing: a newline between `<pre>` and
            the span, or between the span and `</pre>`, is a character the
            coloured layer has and the textarea does not, and every line below
            it would sit one row off.
          -->
          <div class="wiz-code">
            <pre ref="inkEl" class="wiz-code-ink" aria-hidden="true"><span
              v-for="(token, index) in codeTokens"
              :key="index"
              :class="`tok-${token.kind}`"
            >{{ token.text }}</span></pre>
            <textarea
              ref="codeEl"
              v-model="fileText"
              class="wiz-code-edit"
              spellcheck="false"
              wrap="off"
              :disabled="busy || !session.draftFiles"
              :placeholder="session.draftFiles ? '' : 'No package yet.'"
              @scroll="syncInk"
              @blur="applyFile"
            />
          </div>
        </div>
        </div>
      </div>
      <!--
        Call the thing, look at what it says.

        The model was guessing response shapes, and a guess renders "undefined"
        rather than failing — so the loop was: describe the API, get a widget,
        run it, go find the real field names, say them out loud, repeat. One
        request ends that, and the answer travels with the next message.
      -->
      <div v-show="middleTab === 'api'" class="wiz-api">
        <!--
          Read from the host's catalog, never called from here: running a
          provider query for a draft would be a new host capability, and the
          calls the preview makes are already listed under Debug beside it.
        -->
        <p v-if="usedProviders.length" class="wiz-api-heading">Providers</p>
        <section v-for="use in usedProviders" :key="use.id" class="wiz-ep">
          <div class="wiz-ep-head">
            <span class="wiz-ep-id">{{ use.schema?.displayName ?? use.id }}</span>
            <span class="wiz-provider-state" :class="`wiz-provider-state--${use.state}`">
              {{ PROVIDER_STATE_LABEL[use.state] }}
            </span>
          </div>
          <p v-if="use.schema" class="wiz-ep-desc">
            Kavibay makes the requests; the widget asks for them by name. The marks
            compare what the manifest declares with what the code calls. The calls
            the preview made are under Debug.
          </p>
          <p v-else class="wiz-ep-note">
            This Kavibay has no provider <code>{{ use.id }}</code>, so the widget cannot
            get its data. Check the id in <code>manifest.json</code>.
          </p>
          <!--
            Reads are declared for the person, not enforced: the account is the
            read grant. So the marks say what the manifest tells them against
            what the code does, and a gap is a gap in what they were told.
          -->
          <template v-if="queryUses(use, providerCalls).length">
            <p class="wiz-provider-sub">Reads</p>
            <ul class="wiz-provider-queries">
              <li
                v-for="query in queryUses(use, providerCalls)"
                :key="query.name"
                :class="{ 'wiz-provider-unused': !query.declared && !query.called }"
              >
                <code class="wiz-provider-call">{{ query.name }}({{ argSignature(query.args) }})</code>
                <code v-if="query.result" class="wiz-provider-result">
                  → {{ describeResultShape(query.result) }}
                </code>
                <span
                  v-if="query.declared || query.called"
                  class="wiz-provider-badge"
                  :class="{
                    'wiz-provider-badge--warn': !query.known || !query.declared,
                    'wiz-provider-badge--quiet': query.known && query.declared && !query.called,
                  }"
                >
                  {{
                    !query.known
                      ? "Unknown"
                      : !query.declared
                        ? "Not declared"
                        : query.called
                          ? "Declared"
                          : "Declared, not called"
                  }}
                </span>
                <p v-if="query.description" class="wiz-ep-desc">{{ query.description }}</p>
                <p v-if="!query.known" class="wiz-ep-note">
                  {{ use.schema?.displayName ?? use.id }} has no query by this name.
                </p>
                <p v-else-if="!query.declared" class="wiz-ep-note">
                  The code reads this, but its provider entry does not list it under
                  <code>queries</code>, so the approval dialog does not mention it.
                </p>
              </li>
            </ul>
          </template>
          <!--
            Changes are the part the person approves separately, so they are
            listed by what the manifest declares, not by what the provider
            offers. A call the code makes without declaring it is the one to
            flag: the host refuses it the first time the button is pressed.
          -->
          <template v-if="actionUses(use, providerCalls).length">
            <p class="wiz-provider-sub">Changes</p>
            <ul class="wiz-provider-queries">
              <li v-for="action in actionUses(use, providerCalls)" :key="action.name">
                <code class="wiz-provider-call">{{ action.name }}({{ argSignature(action.args) }})</code>
                <span
                  class="wiz-provider-badge"
                  :class="{
                    'wiz-provider-badge--warn': !action.declared,
                    'wiz-provider-badge--quiet': action.declared && !action.called,
                  }"
                >
                  {{ action.declared ? (action.called ? "Declared" : "Declared, not called") : "Not declared" }}
                </span>
                <p v-if="action.description" class="wiz-ep-desc">{{ action.description }}</p>
                <p v-if="!action.declared" class="wiz-ep-note">
                  The code calls this, but its provider entry does not list it under
                  <code>actions</code>, so Kavibay will refuse it.
                </p>
              </li>
            </ul>
          </template>
          <div v-if="use.state === 'disconnected'" class="wiz-ep-actions">
            <button type="button" @click="wizard.openSettings('credentials', use.schema?.credentialType)">
              Connect account
            </button>
          </div>
        </section>

        <p v-if="usedProviders.length && endpointProbes.length" class="wiz-api-heading">Endpoints</p>
        <div v-for="probe in endpointProbes" :key="probe.id" class="wiz-ep">
          <div class="wiz-ep-head">
            <code class="wiz-ep-id">{{ probe.id }}</code>
            <span class="wiz-ep-meta">{{ probe.method }} {{ probe.host }}</span>
          </div>
          <p v-if="probe.description" class="wiz-ep-desc">{{ probe.description }}</p>

          <!--
            A draft holds no credential grant and Rust refuses the call outright
            — so say that here rather than letting somebody fill in a form and
            press a button that cannot work.
          -->
          <p v-if="probe.credential && !credentialReachable(probe.credential)" class="wiz-ep-note">
            Needs the <code>{{ probe.credential }}</code> account. Save and enable this
            widget first — a draft reaches a credential only through a grant its
            own widget already has.
          </p>
          <p
            v-else-if="probe.credential && session.hasDraft && !consentStillMatches"
            class="wiz-ep-note"
          >
            <code>api.json</code> has changed since you approved
            <code>{{ probe.credential }}</code>, so the preview cannot use it. Save and
            review the endpoints again.
          </p>

          <div v-if="probe.inputs.length" class="wiz-ep-args">
            <label v-for="input in probe.inputs" :key="input.name" class="wiz-ep-arg">
              <span>
                {{ input.name }}<em v-if="input.required">*</em>
              </span>
              <KavibaySelect
                v-if="input.values && input.values.length"
                :model-value="probeArg(probe.id, input.name)"
                :options="enumOptions(input.values)"
                size="sm"
                :aria-label="input.name"
                @update:model-value="setProbeArg(probe.id, input.name, String($event))"
              />
              <input
                v-else
                :value="probeArg(probe.id, input.name)"
                :type="input.type === 'number' ? 'number' : 'text'"
                @input="
                  setProbeArg(probe.id, input.name, ($event.target as HTMLInputElement).value)
                "
                :placeholder="input.type"
                spellcheck="false"
              />
            </label>
          </div>

          <div class="wiz-ep-actions">
            <button
              type="button"
              :disabled="!!probing || !previewExtId"
              @click="probeEndpoint(probe)"
            >
              {{ probing === probe.id ? "Calling…" : "Try" }}
            </button>
            <button
              v-if="sampleFor(probe.id)"
              type="button"
              class="wiz-link"
              @click="dropSample(probe.id)"
            >
              Discard response
            </button>
          </div>

          <p v-if="probeErrors[probe.id]" class="wiz-ep-error">{{ probeErrors[probe.id] }}</p>

          <template v-if="sampleFor(probe.id)">
            <p class="wiz-ep-note">
              <template v-if="sampleFor(probe.id)!.sent">
                Sent with an earlier message — the model has this shape.
              </template>
              <template v-else>
                Goes to the model with your next message, so it writes against these
                names instead of guessing them.
              </template>
            </p>
            <pre class="wiz-ep-body">{{ sampleFor(probe.id)!.body }}</pre>
          </template>
        </div>
      </div>

      <div
        v-show="middleTab === 'chat'"
        ref="transcriptEl"
        class="wiz-transcript"
        :class="{ 'wiz-transcript--empty': !session.bubbles.length }"
      >
        <!--
          Two empty states, and which one shows is the point: an unconfigured
          Wizard cannot do the thing the other one invites. Naming the platforms
          here rather than in Settings means the requirement and the way to
          satisfy it arrive together.
        -->
        <div v-if="!session.bubbles.length && !hasAnyKey" class="wiz-keygate">
          <p class="wiz-keygate-title">The Wizard writes widgets with an AI model</p>
          <p class="wiz-keygate-lead">
            That runs on your own account, so it needs an API key from one of
            these. Pick a platform to add its key — you only do this once.
          </p>
          <ul class="wiz-keygate-list">
            <li v-for="platform in platforms" :key="platform.id">
              <button type="button" class="wiz-keygate-option" @click="openPlatformSettings(platform)">
                <span class="wiz-keygate-name">
                  {{ platform.label }}
                  <span v-if="platform.recommended" class="wiz-keygate-tag">recommended</span>
                </span>
                <span class="wiz-keygate-sub">
                  {{ platform.modelCount }}
                  {{ platform.modelCount === 1 ? "model" : "models" }}
                  <template v-if="platform.configured"> · key added</template>
                </span>
              </button>
            </li>
          </ul>
        </div>
        <div v-else-if="!session.bubbles.length" class="wiz-starters">
          <p class="wiz-starters-title">What would you like to make?</p>
          <p class="wiz-starters-hint">Describe your idea, or pick one and make it yours.</p>
          <div class="wiz-starters-grid" role="group" aria-label="Widget ideas">
            <button
              v-for="starter in starterPrompts"
              :key="starter.label"
              type="button"
              class="wiz-starter"
              :disabled="busy"
              @click="chooseStarter(starter.prompt)"
            >
              {{ starter.label }}
            </button>
          </div>
        </div>
        <!--
          One turn: the message, and underneath it the footnotes about it.

          The footnotes used to live *inside* the bubble, which was invisible
          while a bubble had no ground of its own. Once notes were given one the
          checkpoint became a button sitting in the middle of a grey box that is
          otherwise a sentence — and it had to be always visible, because a box
          reserving space for something invisible looks broken. Outside the box
          it goes back to being what it was: reserved, silent, and there when
          the pointer is on the turn it belongs to.
        -->
        <div
          v-for="(bubble, index) in session.bubbles"
          :key="index"
          :class="['wiz-turn', bubble.role, { note: isPlainNote(bubble) }]"
        >
          <div
            :class="['wiz-bubble', bubble.role, bubble.tone, { note: isPlainNote(bubble) }]"
          >
          <div v-if="bubble.images?.length" class="wiz-thumbs">
            <img
              v-for="(image, at) in bubble.images"
              :key="at"
              class="wiz-thumb"
              :src="thumbSrc(image)"
              alt="attached image"
            />
          </div>
          <template v-if="bubble.text">
            <span
              :class="{
                'wiz-bubble-source-wrap':
                  sourceAuthor(bubble.author, bubble.clientName) &&
                  sourceAuthor(bubble.author, bubble.clientName) !== 'wizard',
              }"
              :title="
                sourceAuthor(bubble.author, bubble.clientName) &&
                sourceAuthor(bubble.author, bubble.clientName) !== 'wizard'
                  ? describeDraftClient(sourceAuthor(bubble.author, bubble.clientName), bubble.clientName)
                  : undefined
              "
            >
              <McpClientMark
                v-if="sourceAuthor(bubble.author, bubble.clientName) === 'codex' || sourceAuthor(bubble.author, bubble.clientName) === 'claude'"
                :client="sourceIconClient(bubble.author, bubble.clientName)"
                :size="14"
                class="wiz-bubble-source"
              />
              <template v-for="(part, partAt) in mentionSegments(bubble)" :key="partAt">
                <span v-if="part.kind === 'text'">{{ part.text }}</span>
                <span v-else-if="part.kind === 'element'" class="wiz-inline-element wiz-inline-element--history" :title="part.selector">
                  <IconBase :size="11" aria-hidden="true"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M9 9l3 10 2-5 5-2Z" /></IconBase>
                  <span class="wiz-inline-element__label">{{ part.selector.split(' > ').pop() }}</span>
                </span>
                <span v-else class="wiz-inline-mention">
                  <span class="wiz-inline-mention-mark">
                    <BrandMark :provider="part.id" :size="14" />
                  </span>
                  <span>{{ part.label }}</span>
                </span>
              </template>
            </span>
          </template>

          <!--
            The same dialog Settings shows, from the same builder. Not a second
            rendering of the same question: a consent screen that exists twice
            drifts, and the copy that drifts is the one that stops describing
            what is actually granted.
          -->
          <template v-if="bubble.approve && !bubble.approve.done">
            <component
              :is="permissionRequestHost"
              v-if="approvalRequestFor(bubble.approve.id) && permissionRequestHost"
              :display-name="approvalNameFor(bubble.approve.id)"
              :request="approvalRequestFor(bubble.approve.id)!"
              @approve="approveFromBubble(bubble, $event)"
              @cancel="bubble.approve.done = true"
            />
            <p v-else class="wiz-consent-note">
              This package is not there any more.
            </p>
            <!--
              Offered where the dialog is, because that is where somebody
              decides they are tired of it — not in a Settings page they would
              have to go looking for while holding a half-saved widget.

              Only while Developer Extensions is on. It is that switch, reached
              from here; without the gate it would be a second and weaker
              consent bypass, which is the one thing this must not become.
            -->
            <label
              v-if="permissionRequestHost && developerExtensions"
              class="wiz-auto-approve"
            >
              <input
                type="checkbox"
                :checked="wizardAutoEnable"
                :disabled="busy"
                @change="setAutoApprove(($event.target as HTMLInputElement).checked)"
              />
              <span>
                Approve automatically from now on
                <small>Grants each widget exactly what it asks for, without this step.</small>
              </span>
            </label>
          </template>


          <!--
            The widget's own crash, handed back in one click. The alternative
            is reading it off the debug panel and retyping it as a sentence,
            which is the person acting as a courier between two parties that
            both already have the exact words.
          -->
          <div v-if="bubble.repair" class="wiz-consent-actions">
            <button
              type="button"
              class="wiz-consent-btn"
              :disabled="bubble.repair.done || busy"
              @click="repairFromBubble(bubble)"
            >
              {{ bubble.repair.done ? "Sent" : "Fix it" }}
            </button>
          </div>

          <!--
            Button first, hint after it. The row was right-aligned like a
            dialog's, which put the sentence explaining the button on the far
            side of it — the caption arriving after the thing it captions, at
            the end of a line the eye reads left to right.
          -->
          <div v-if="bubble.run && index === latestRunIndex" class="wiz-run-actions">
            <button
              type="button"
              class="wiz-run-btn"
              :disabled="bubble.run.done || busy"
              v-tip="'Or find it in the palette (Ctrl+Space)'"
              @click="runFromBubble(bubble)"
            >
              {{ bubble.run.done ? "On the desk" : "Add to desk" }}
            </button>
          </div>

          <template v-if="bubble.enable">
            <template v-if="!bubble.enable.preApproved">
              <ul class="wiz-consent-list">
                <li v-for="(line, at) in bubble.enable.lines" :key="at">{{ line }}</li>
              </ul>
              <p class="wiz-consent-note">
                Runtime packages are untrusted code. Enable only what you trust.
              </p>
            </template>
            <div class="wiz-consent-actions">
              <button
                type="button"
                class="wiz-consent-btn"
                :disabled="bubble.enable.done || busy"
                @click="enableFromBubble(bubble)"
              >
                {{
                  bubble.enable.done
                    ? bubble.enable.preApproved
                      ? "Saved"
                      : "Enabled"
                    : bubble.enable.preApproved
                      ? "Save"
                      : bubble.enable.needsSave
                        ? "Save & enable"
                        : "Enable"
                }}
              </button>
            </div>
          </template>
          </div>
          <!--
            The message's own footnotes: what it cost, and the package state it
            produced. Both are answers to questions you only sometimes ask, and
            two permanent extra lines under every answer made the transcript
            harder to read than the conversation in it.

            ONE WRAPPER, AND IT ALWAYS OCCUPIES ITS HEIGHT. Revealing on hover
            by growing the bubble would push every later message down the moment
            the pointer crossed an older one — the jump this exists to avoid. So
            the space is reserved and only the ink fades in; nothing ever moves.
          -->
          <div
            v-if="bubble.usage || (bubble.version && versionsById.has(bubble.version))"
            class="wiz-meta"
          >
            <!--
              What this answer cost. Under the message rather than in a panel:
              the number belongs to the thing that produced it, and a running
              total nobody can attribute to a turn is a number nobody acts on.
            -->
            <span
              v-if="bubble.usage"
              class="wiz-usage-mark"
              tabindex="0"
              role="img"
              :aria-label="usageTooltip(bubble)"
              v-tip="usageTooltip(bubble)"
            >
              <BrandMark v-if="usageBrand(bubble)" :provider="usageBrand(bubble)" :size="14" />
              <BrainIcon v-else :size="14" />
            </span>

            <!--
              The checkpoint, where the change it belongs to was made.

              "Go back to before I said change the background" is a sentence
              about the conversation. The version strip in Files answers it with
              timestamps, which makes the reader translate. Here the answer is
              the message itself.

              Drawn only while the state still exists: a bubble keeps its id
              forever and the list holds five, so an old message offers nothing
              rather than a button that cannot work.
            -->
            <div v-if="bubble.version && versionsById.has(bubble.version)" class="wiz-cp">
              <template v-if="bubble.version === session.currentVersion">
                <span class="wiz-cp-dot" aria-hidden="true">●</span>
                <span>This is what is on disk</span>
              </template>
              <button
                v-else
                type="button"
                class="wiz-cp-btn"
                :disabled="busy"
                @click="goBackTo(bubble.version)"
              >
                <IconBase :size="14" class="wiz-cp-icon">
                  <path d="m9 10-5 5 5 5M4 15h11a5 5 0 0 0 0-10h-3" />
                </IconBase>
                <span>Back to this version</span>
              </button>
            </div>
          </div>
        </div>
        <p v-if="busy" class="wiz-hint wiz-working" role="status" aria-live="polite">
          <span class="wiz-working-icon" data-icon-motion="on">
            <BrainIcon :size="16" animated />
          </span>
          <span>Working…</span>
        </p>
      </div>

      <div v-if="middleTab === 'chat'" class="wiz-compose-tools">
        <WizardSuggestions
          v-if="showSuggestions"
          class="wiz-compose-suggestions"
          :suggestions="suggestions"
          @choose="chooseSuggestion"
        />
        <WizardConversationMenu
          :key="session.id"
          :usage="sessionUsage"
          :cost="costLabel(sessionCost)"
          :copy-state="transcriptCopyState"
          :can-export="session.bubbles.length > 0"
          :show-suggestions="showSuggestions"
          @update:show-suggestions="showSuggestions = $event; saveLayout()"
          @export="copyTranscript"
        />
      </div>

      <!-- Part of the conversation, so it goes with it. -->
      <div
        v-show="middleTab === 'chat'"
        class="wiz-compose"
        @dragover.prevent
        @drop.prevent="attach($event.dataTransfer?.files ?? null)"
      >
        <div v-if="session.attachments.length" class="wiz-thumbs">
          <button
            v-for="(image, index) in session.attachments"
            :key="index"
            type="button"
            class="wiz-thumb-remove"
            v-tip="'Remove'"
            @click="removeAttachment(index)"
          >
            <img class="wiz-thumb" :src="thumbSrc(image)" alt="attachment" />
          </button>
        </div>
        <div
          ref="composerEl"
          class="wiz-composer-editor"
          role="textbox"
          aria-multiline="true"
          data-placeholder="Describe the widget, drop a screenshot, or ask for a change…"
          :contenteditable="busy ? 'false' : 'true'"
          @input="onComposerInput"
          @keydown="onComposerKeydown"
          @keyup="updateIntegrationMenu"
          @mouseup="updateIntegrationMenu"
          @focus="updateIntegrationMenu"
          @blur="rememberComposerCaret"
          @paste="onComposerPaste"
        ></div>
        <Teleport to="body">
          <div
            v-if="integrationMenuOpen"
            ref="integrationMenuEl"
            class="wiz-integrations-menu"
            :style="integrationMenuStyle"
            role="listbox"
            aria-label="Choose an integration"
          >
            <button
              v-for="(option, index) in filteredIntegrationOptions"
              :key="option.id"
              type="button"
              class="wiz-integration-option"
              :class="{ 'wiz-integration-option--active': index === integrationMenuIndex }"
              role="option"
              :aria-selected="index === integrationMenuIndex"
              :aria-label="
                option.connected ? option.label : `${option.label}, not connected`
              "
              @mousedown.prevent="chooseIntegration(option)"
            >
              <BrandMark :provider="option.id" :size="16" />
              <span
                class="wiz-account-name"
                :class="{ 'wiz-account-name--offline': !option.connected }"
              >{{ option.label }}</span>
              <span
                v-if="!option.connected"
                class="wiz-account-offline"
                v-tip="'Not connected — open Settings to connect'"
                @mousedown.stop.prevent="openProviderSettings(option, $event)"
              >
                <UnplugIcon :size="14" :stroke-width="1.9" />
              </span>
            </button>
          </div>
        </Teleport>
        <div class="wiz-compose-bar">
          <input
            ref="fileInputEl"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            multiple
            hidden
            @change="onFilePicked"
          />
          <div ref="plusEl" class="wiz-plus">
            <button
              type="button"
              class="wiz-attach"
              v-tip="'Add'"
              :disabled="busy"
              @click="attachMenuOpen = !attachMenuOpen"
            >
              +
            </button>
            <div v-if="attachMenuOpen" class="wiz-plus-menu">
              <button
                type="button"
                class="wiz-plus-item"
                @click="
                  attachMenuOpen = false;
                  fileInputEl?.click();
                "
              >
                Upload image
              </button>
            </div>
          </div>
          <span class="wiz-spacer" />
          <!--
            Which accounts the widget reads from — and, implicitly, which
            package format is being authored: any account makes it a contract
            widget, none makes it standalone. That was a second dropdown until
            it became clear it only ever restated this one.

            Multiple rows can be selected because the question is not "which
            account" but "which accounts": the widget people ask for first —
            room temperatures with the outdoor temperature under them — needs
            two, and a single-choice control would make that widget look
            impossible.
          -->
          <details
            ref="accountsEl"
            class="wiz-accounts"
            :class="{ 'wiz-accounts--standalone': selectedProviders.length === 0 }"
            @toggle="accountsOpen = accountsEl?.open ?? false"
          >
            <!--
              The icon replaces the status dot rather than joining it. The dot
              said one thing with colour — is anything connected — and the icon
              can say the same thing the same way while also saying what the
              control is for, which the dot never did.
            -->
            <summary :aria-label="selectedProviderAria">
              <ServerPlusIcon class="wiz-accounts-icon" :size="14" :stroke-width="1.9" />
              <span class="wiz-accounts-label">{{ selectedProviderLabel }}</span>
              <WizardChevron
                class="wiz-accounts-chevron"
                :direction="accountsOpen ? 'up' : 'down'"
              />
            </summary>
            <ul>
              <li v-for="option in providerOptions" :key="option.id">
                <button
                  type="button"
                  class="wiz-account-item"
                  role="menuitemcheckbox"
                  :aria-checked="selectedProviders.includes(option.id)"
                  :aria-label="
                    option.connected
                      ? option.label
                      : `${option.label}, not connected`
                  "
                  :disabled="busy"
                  @click="toggleProvider(option.id, !selectedProviders.includes(option.id))"
                >
                  <!--
                    Nothing at all for a provider we ship no logo for, which is
                    why every account row still reads fine without one.
                  -->
                  <BrandMark :provider="option.id" :size="16" />
                  <span
                    class="wiz-account-name"
                    :class="{ 'wiz-account-name--offline': !option.connected }"
                  >{{ option.label }}</span>
                  <span
                    v-if="selectedProviders.includes(option.id)"
                    class="wiz-account-check"
                    aria-hidden="true"
                  >
                    ✓
                  </span>
                  <span
                    v-else-if="!option.connected"
                    class="wiz-account-offline"
                    v-tip="'Not connected — open Settings to connect'"
                    @click.stop="openProviderSettings(option, $event)"
                  >
                    <UnplugIcon :size="14" :stroke-width="1.9" />
                  </span>
                </button>
              </li>
            </ul>
          </details>
          <!--
            One control, not two. Model and effort are read together and answer
            one question — what is about to run — so the trigger states both and
            the settings live a level down.
          -->
          <WizardModelMenu
            v-model="session.model"
            :models="models"
            :effort="effort ?? ''"
            :effort-levels="effortLevels"
            :disabled="busy"
            @update:effort="effort = $event"
            @add-key="wizard.openSettings('ai', $event)"
          />
          <button v-if="busy" type="button" @click="stop">Stop</button>
          <button
            v-else
            type="button"
            class="wiz-send"
            :disabled="!canSend"
            title="Send (Enter) · New line (Shift+Enter)"
            aria-label="Send"
            @click="send"
          >
            Send
          </button>
        </div>
      </div>
      <WizardMcpHelp
        v-if="sidebarHidden || tooNarrow"
        @open-settings="wizard.openSettings('mcp')"
      />
    </section>

    <!-- Right: the draft, in the chrome it will actually wear -->
    <div
      v-show="!tooNarrow"
      class="wiz-grip wiz-c4"
      role="separator"
      aria-orientation="vertical"
      aria-label="Preview width"
      tabindex="0"
      @pointerdown.prevent="startDrag('preview', $event)"
      @keydown.left.prevent="nudge('preview', -1)"
      @keydown.right.prevent="nudge('preview', 1)"
    />

    <section v-show="!tooNarrow" class="wiz-preview wiz-c5">
      <div class="wiz-actions" role="group" aria-label="Widget actions">
        <span ref="previewDebugTarget" class="wiz-debug-action"></span>
        <button
          v-if="pointAndPromptEnabled"
          type="button"
          class="wiz-action--pick"
          :disabled="!canPickElement"
          :aria-pressed="pickingElement"
          aria-label="Select preview elements"
          v-tip="'Select elements to describe a change (development only)'"
          @click="pickingElement ? finishPreviewPick() : pickingElement = true"
        >
          <IconBase :size="14"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M9 9l3 10 2-5 5-2Z" /></IconBase>
        </button>
        <button
          type="button"
          :disabled="!canExport"
          class="wiz-action--share"
          v-tip="'Share this widget as a file or preview image'"
          @click="shareFeedback = ''; sharing = true"
        >
          <IconBase :size="13">
            <path d="M12 16V3m-4 4 4-4 4 4M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" />
          </IconBase>
          Share
        </button>
        <button
          type="button"
          :disabled="!canSave"
          v-tip="'Save this widget and open it on the desk'"
          @click="saveAndRun"
        >
          <IconBase :size="13"><path d="m8 5 11 7-11 7Z" /></IconBase>
          Run on desk
        </button>
        <button
          type="button"
          class="wiz-action--primary"
          :disabled="!canSave"
          v-tip="saveShortcutTip"
          aria-keyshortcuts="Meta+S Control+S"
          @click="() => keep()"
        >
          <IconBase :size="13"><path d="M20 6 9 17l-5-5" /></IconBase>
          Save
        </button>
      </div>
      <p v-if="pickingElement" class="wiz-pick-hint" role="status">Click elements to add them to your message. Esc to finish.</p>
      <div class="wiz-preview-body">
        <div v-if="showFirstVersionGeneration" class="wiz-empty">
          <WizardGenerationStatus />
        </div>
        <WizardPreviewStage
          v-else-if="previewExtId"
          :ext-id="previewExtId"
          :entry-url="previewUrl ?? ''"
          :title="previewTitle"
          :nonce="previewNonce"
          :granted-permissions="session.previewPermissions"
          :format="previewFormat"
          :initial-size="session.previewSize"
          :initial-scale="session.previewScale"
          :unmet="previewUnmet"
          :sharing="sharing"
          :share-busy="busy"
          :share-feedback="shareFeedback"
          :picking="pickingElement"
          :debug-target="previewDebugTarget"
          @selected="selectPreviewElement"
          @cancel-pick="finishPreviewPick"
          @close-share="sharing = false"
          @export="exportWidget"
          @resized="onPreviewResized"
          @rename="session.widgetName = $event"
          @fault="onPreviewFault"
        />
        <div v-else class="wiz-empty">
          Your widget will appear here.
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.wiz-pick-hint { margin: 36px 4px 0; font-size: 11px; opacity: 0.65; }
.wiz-actions button[aria-pressed="true"],
.wiz-actions :deep(button[aria-expanded="true"]) { background: rgba(var(--fg-rgb), 0.12); opacity: 1; }
.wiz-debug-action { display: contents; }

.wiz {
  display: grid;
  grid-template-rows: minmax(0, 1fr);
  align-items: stretch;
  gap: 10px;
  height: 100%;
  padding: 10px;
  box-sizing: border-box;
  font-size: 12px;
  color: rgba(var(--fg-rgb), 0.9);
}

/*
 * Every child names its own column.
 *
 * Without this the grid auto-places, and auto-placement counts only the
 * children that are laid out: `display: none` does not leave a hole, it
 * removes the item and slides everything after it one track to the left. So
 * folding the sidebar away moved the rail into the 0px track, the middle
 * column into the 22px rail track, and the conversation rendered one character
 * per line — the collapse looked broken when what broke was the placement of
 * the three panels beside it.
 *
 * Pinning the tracks makes hiding a panel mean only "this panel is not shown".
 */
.wiz-c1 {
  grid-column: 1;
}
.wiz-c2 {
  grid-column: 2;
  /* The grid gap sits between the sidebar edge and this 6px track. Move the
     hit area back over that boundary so a click lands where the divider is. */
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  left: -13px;
  z-index: 2;
}

.wiz-c2--sidebar-collapsed {
  left: 0;
}
.wiz-c3 {
  grid-column: 3;
}

.wiz-c4 {
  grid-column: 4;
}
.wiz-c5 {
  grid-column: 5;
}

.wiz-side,
.wiz-main,
.wiz-preview {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  height: 100%;
  gap: 8px;
}

.wiz-side {
  overflow: hidden;
}

.wiz-side-sections {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
  gap: 8px;
}

.wiz-side-group {
  display: flex;
  flex-direction: column;
  gap: 0;
  flex: 0 0 auto;
  min-height: 0;
  overflow: hidden;
}

.wiz-side-group--all {
  flex: 1 1 0;
}

.wiz-side-group-body {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
  padding: 2px 0 8px;
  overflow-y: auto;
}

.wiz-side-item {
  display: flex;
  align-items: center;
  gap: 2px;
}

/*
  Projects sit close, the way a harness lists its threads. What keeps six
  conversations from reading as six projects is no longer air above every
  project, which made a folded list twice as tall as its names: conversations
  are indented to the name column, carry no status dot, and are set lighter.
  An unfolded project still gets air after its conversations.
*/
.wiz-side-item--stacked + .wiz-side-item--stacked {
  margin-top: 1px;
}

/*
  One highlight per row, on one element, in two clearly different weights.

  Hover and selection used to be drawn on different elements — selection on the
  whole row, hover on the button inside it — so they were two greys of almost
  the same value in two different shapes, and the row you were pointing at
  looked like the row that was open. Both now paint the same box, and the
  selected one is the app's own selected-row treatment: a lift with a rim and a
  sheen, which is a different *kind* of thing from a flat tint rather than a
  slightly stronger one.
*/
.wiz-side-line,
.wiz-side-history > .wiz-side-item {
  position: relative;
  border-radius: 8px;
  transition: background-color 100ms ease;
}

.wiz-side-line:hover,
.wiz-side-history > .wiz-side-item:hover {
  background: var(--fill, rgba(var(--fg-rgb), 0.06));
}

.wiz-side-sel,
.wiz-side-sel:hover {
  background-color: var(--row-selected-bg, rgba(var(--fg-rgb), 0.1));
  background-image: var(--row-selected-sheen, none);
  box-shadow:
    var(--row-selected-rim, inset 0 0 0 1px rgba(255, 255, 255, 0.05)),
    var(--row-selected-shadow, 0 1px 3px rgba(0, 0, 0, 0.3));
}

.wiz-side-row {
  flex: 1;
  min-width: 0;
  text-align: left;
  border: none;
  background: none;
  color: inherit;
  font: inherit;
  /* The padding is the row's air; the highlight behind it is drawn by the line
     so hover and selection are one box rather than two. */
  padding: 6px 8px;
  /* Only so a focus ring follows the highlight it sits in; the fill itself is
     painted by the line behind it. */
  border-radius: 8px;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/*
  Shrinks three times faster than the name. Both are on one line now, and when
  they do not fit the name is the half worth reading — proportional shrinking
  cut a word off each instead.
*/
.wiz-side-id {
  flex: 0 3 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 10px;
  font-style: normal;
  opacity: 0.4;
}

/*
  A row is two lines when it has something to say and one when it does not, so
  the list does not pay for the second line thirty times over.
*/
.wiz-side-item--stacked {
  display: block;
  padding: 1px 0;
}

.wiz-side-line {
  display: flex;
  align-items: center;
  gap: 2px;
}

.wiz-side-name {
  display: block;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.wiz-side-item--stacked > .wiz-side-line > .wiz-side-row .wiz-side-name {
  flex: 0 1 auto;
  font-weight: 500;
}

/*
  A saved package stays green until it has pending work. Amber means the widget
  is still runnable from the palette but a newer draft is waiting to be saved;
  a hollow ring is a draft that has never been published.
*/
/* Centred in a 14px column, the width of the New project icon above it, so
   the names start where that label starts. */
.wiz-side-dot {
  flex: 0 0 auto;
  width: 7px;
  height: 7px;
  margin: 0 3px 0 4px;
  border-radius: 50%;
}

.wiz-side-dot--live {
  background: rgb(90, 205, 130);
}

.wiz-side-dot--changed {
  background: rgb(218, 164, 89);
  box-shadow: 0 0 0 1px rgba(218, 164, 89, 0.22);
}

/*
  A ring rather than a filled white disc: filled, it is the brightest thing on
  the row and pulls the eye to every unfinished project before it reaches the
  names. Hollow reads as "not there yet", which is what it means.
*/
.wiz-side-dot--draft {
  background: none;
  box-shadow: inset 0 0 0 1.5px rgba(var(--fg-rgb), 0.85);
}

.wiz-side-presence {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  cursor: help;
}

.wiz-side-presence-dot {
  display: block;
}

.wiz-side-warn {
  display: inline-block;
  width: 13px;
  height: 13px;
  margin-right: 4px;
  border-radius: 50%;
  background: rgba(255, 120, 120, 0.22);
  color: rgba(255, 157, 157, 0.95);
  font-size: 10px;
  font-weight: 700;
  line-height: 13px;
  text-align: center;
  vertical-align: baseline;
}

/*
  Name and caret on one line, the caret directly after the name.

  On the left it was a column of arrows the eye has to cross to reach the first
  letter of every row. After the name it sits where the name ends, which is
  where somebody asking "is there more in here" is already looking.
*/
.wiz-side-head {
  display: flex;
  /* Centred, not baseline: a caret has no baseline worth aligning to, and on
     one it sat below the text and read as having slipped. */
  align-items: center;
  gap: 6px;
  /* The constraint the name needs to be able to shorten itself. Without a width
     here the row shrink-wraps its content, overflows the button and is cut by
     its `overflow: hidden` — the title lost its last letters *and* its ellipsis,
     and the caret ended up sitting on top of them. */
  width: 100%;
  min-width: 0;
}

/*
  Drawn rather than typed. The arrowhead characters differ per font in size and
  in how far they sit off the baseline, so the one glyph that looked right here
  is the one that will look wrong on the next machine.
*/
.wiz-side-caret {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  opacity: 0.35;
  transition:
    transform 120ms ease,
    opacity 120ms ease;
}

.wiz-side-caret--open {
  transform: rotate(90deg);
}

.wiz-side-row:hover .wiz-side-caret {
  opacity: 0.75;
}

/*
  The row's actions sit on top of the end of the row and take no width from it,
  so a name uses the whole row until the pointer arrives.

  The text under them fades out instead of being covered. A cover would need an
  opaque colour, and the row is a tint over a card whose opacity the person
  sets, so no colour matches it in both themes. The fade is as wide as the
  buttons that are showing: 20px each, plus the inset.
*/
.wiz-side-line {
  --wiz-side-actions: 64px;
}

.wiz-side-line--bare {
  --wiz-side-actions: 44px;
}

.wiz-side-line--armed {
  --wiz-side-actions: 84px;
}

.wiz-side-line--bare.wiz-side-line--armed {
  --wiz-side-actions: 64px;
}

.wiz-side-history > .wiz-side-item {
  --wiz-side-actions: 24px;
}

.wiz-side-actions {
  position: absolute;
  top: 0;
  right: 4px;
  bottom: 0;
  display: flex;
  align-items: center;
  opacity: 0;
  transition: opacity 120ms ease;
}

/*
  Each row reveals its own actions, and only its own.

  A project *is* an item and its conversations are items inside it, so a
  descendant combinator on the item matched every nested delete button the
  moment the pointer entered the project block. Child combinators keep each
  reveal to the row that owns it.
*/
.wiz-side-line:hover > .wiz-side-actions,
.wiz-side-line:has(:focus-visible) > .wiz-side-actions,
.wiz-side-line--armed > .wiz-side-actions,
.wiz-side-item--dragging > .wiz-side-line > .wiz-side-actions,
.wiz-side-history > .wiz-side-item:hover > .wiz-side-actions,
.wiz-side-history > .wiz-side-item:has(:focus-visible) > .wiz-side-actions {
  opacity: 1;
}

.wiz-side-line:hover > .wiz-side-row,
.wiz-side-line:has(:focus-visible) > .wiz-side-row,
.wiz-side-line--armed > .wiz-side-row,
.wiz-side-item--dragging > .wiz-side-line > .wiz-side-row,
.wiz-side-history > .wiz-side-item:hover > .wiz-side-row,
.wiz-side-history > .wiz-side-item:has(:focus-visible) > .wiz-side-row {
  -webkit-mask-image: linear-gradient(
    to left,
    transparent var(--wiz-side-actions),
    #000 calc(var(--wiz-side-actions) + 16px)
  );
  mask-image: linear-gradient(
    to left,
    transparent var(--wiz-side-actions),
    #000 calc(var(--wiz-side-actions) + 16px)
  );
}

.wiz-side-add,
.wiz-side-grip,
.wiz-side-del {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  border-radius: 5px;
  background: none;
  color: inherit;
  font: inherit;
  line-height: 1;
  cursor: pointer;
  transition:
    opacity 120ms ease,
    background-color 120ms ease;
}

/*
  Starting a conversation is an action on the project, so it is on the project's
  row rather than a line inside it that only exists once the project is open.
*/
.wiz-side-add {
  font-size: 15px;
  opacity: 0.55;
}

.wiz-side-add:hover:not(:disabled) {
  opacity: 1;
  background: rgba(var(--fg-rgb), 0.12);
}

.wiz-side-add:focus-visible {
  opacity: 1;
  outline: 1px solid rgba(var(--fg-rgb), 0.45);
  outline-offset: -1px;
}

.wiz-side-grip {
  font-size: 11px;
  opacity: 0.4;
  cursor: grab;
  /* The pointer must not be able to select text out from under a drag. */
  touch-action: none;
  user-select: none;
}

.wiz-side-item--dragging .wiz-side-grip {
  cursor: grabbing;
}

.wiz-side-item--dragging {
  opacity: 0.5;
}

/*
  The conversations hang off the project by indentation alone: their text
  starts in the project name's column, so the eye can tell a project from its
  own contents without a rail or a panel drawn around them.
*/
.wiz-side-history {
  display: flex;
  flex-direction: column;
  gap: 1px;
  margin: 1px 0 6px 20px;
}

/*
  Two things on one line: what was asked, and how long ago. The time is what
  makes a list of near-identical requests navigable, and it is right-aligned so
  the labels stay a readable column rather than a ragged one.
*/
.wiz-side-row--older {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 5px 8px;
  font-size: 12px;
  line-height: 1.35;
  opacity: 0.72;
}

.wiz-side-row--older:hover:not(:disabled) {
  opacity: 1;
}

.wiz-side-when {
  flex: 0 0 auto;
  margin-left: auto;
  font-size: 10px;
  opacity: 0.6;
}

/*
  The row whose conversation is being worked on, marked where a harness marks
  a running thread: at the end of the row, in place of its age.
*/
.wiz-side-spinner {
  flex: 0 0 auto;
  align-self: center;
  width: 9px;
  height: 9px;
  margin-left: auto;
  border: 1.5px solid rgba(var(--fg-rgb), 0.2);
  border-top-color: rgba(var(--fg-rgb), 0.8);
  border-radius: 50%;
  animation: wiz-side-spin 0.8s linear infinite;
}

@keyframes wiz-side-spin {
  to {
    transform: rotate(360deg);
  }
}

.wiz-side-del {
  font-size: 14px;
  opacity: 0.45;
}

.wiz-side-del:hover:not(:disabled),
.wiz-side-del:focus-visible {
  opacity: 0.9;
  background: rgba(var(--fg-rgb), 0.12);
}

.wiz-side-del:focus-visible {
  outline: 1px solid rgba(var(--fg-rgb), 0.45);
  outline-offset: -1px;
}

/* Armed is a state, not a hover: it stays visible until it is used or times out. */
.wiz-side-del--armed,
.wiz-side-del--armed:hover:not(:disabled) {
  width: 40px;
  font-size: 10px;
  border-radius: 999px;
  background: rgba(255, 120, 120, 0.2);
  color: rgba(255, 157, 157, 0.95);
  opacity: 1;
}

/*
  The sidebar's own actions are rows like the projects under them, not a
  button the width of the column: the list is what this column is for.
*/
.wiz-side-top {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: 0 0 auto;
}

.wiz-new {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding: 6px 8px;
  border: none;
  border-radius: 8px;
  background: none;
  color: inherit;
  font: inherit;
  font-weight: 500;
  text-align: left;
  cursor: pointer;
  transition: background-color 100ms ease;
}

.wiz-new:hover:not(:disabled) {
  background: var(--fill, rgba(var(--fg-rgb), 0.08));
}

.wiz-new:focus-visible {
  outline: 1px solid rgba(var(--fg-rgb), 0.45);
  outline-offset: -1px;
}

.wiz-new:disabled {
  opacity: 0.5;
  cursor: default;
}

.wiz-new > .lmi {
  flex: 0 0 auto;
  opacity: 0.75;
}

.wiz-side-toggle,
.wiz-side-expand {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: 26px;
  height: 26px;
  padding: 0;
  border: none;
  border-radius: 7px;
  background: none;
  color: inherit;
  opacity: 0.55;
  cursor: pointer;
  transition:
    opacity 120ms ease,
    background-color 120ms ease;
}

.wiz-side-toggle:hover,
.wiz-side-expand:hover {
  background: var(--fill, rgba(var(--fg-rgb), 0.08));
  opacity: 1;
}

.wiz-side-toggle:focus-visible,
.wiz-side-expand:focus-visible {
  outline: 1px solid rgba(var(--fg-rgb), 0.45);
  outline-offset: -1px;
  opacity: 1;
}

.wiz-side-heading {
  flex: 0 0 auto;
  margin: 6px 0 0;
  padding: 0 8px;
  font-size: 11px;
  font-weight: 500;
  color: rgba(var(--fg-rgb), 0.45);
}

.wiz-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
  /* The tab labels fold to their icons when the name needs the room. */
  container-type: inline-size;
}

/*
 * A title, not a form field.
 *
 * It was a filled box spanning the panel, which is how you draw something
 * somebody still has to do. The name is usually already right — the model sets
 * it — so it reads as text and only offers itself when the pointer is on it.
 */
.wiz-name-input {
  flex: 1 1 auto;
  min-width: 60px;
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  padding: 4px 6px;
  border-radius: 7px;
  border: 1px solid transparent;
  background: transparent;
  color: inherit;
}

.wiz-name-input:hover:not(:disabled) {
  background: rgba(var(--fg-rgb), 0.05);
}

.wiz-name-input:focus {
  background: rgba(var(--fg-rgb), 0.05);
  border-color: rgba(var(--fg-rgb), 0.2);
  outline: none;
}

.wiz-presence {
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
  gap: 6px;
  min-height: 24px;
  margin: 0;
  padding: 3px 8px;
  border: 1px solid rgba(var(--fg-rgb), 0.12);
  border-radius: 999px;
  background: rgba(var(--fg-rgb), 0.055);
  font-size: 11px;
  opacity: 0.78;
}

.wiz-presence--active {
  border-color: rgba(110, 168, 110, 0.4);
  background: rgba(110, 168, 110, 0.12);
  opacity: 1;
}

.wiz-presence-mark {
  flex: none;
}

.wiz-presence-dot,
.wiz-side-presence-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #6ea86e;
}

.wiz-presence--active .wiz-presence-mark,
.wiz-presence--active .wiz-presence-dot,
.wiz-side-presence--active {
  animation: wiz-presence-pulse 1.4s ease-in-out infinite;
}

@keyframes wiz-presence-pulse {
  50% {
    opacity: 0.4;
  }
}

.wiz-setup {
  margin: 0;
  font-size: 11px;
  opacity: 0.75;
}

.wiz-draft-error,
.wiz-mcp-conflict {
  margin: 0;
  padding: 9px 10px;
  border: 1px solid rgba(250, 145, 145, 0.35);
  border-radius: 8px;
  background: rgba(220, 80, 80, 0.1);
  font-size: 11px;
  line-height: 1.45;
}

.wiz-mcp-conflict {
  border-color: rgba(245, 195, 115, 0.4);
  background: rgba(220, 160, 70, 0.1);
}

.wiz-draft-error {
  color: rgba(255, 175, 175, 0.95);
}

.wiz-mcp-conflict p {
  margin: 4px 0 8px;
  opacity: 0.78;
}

.wiz-mcp-conflict-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.wiz-mcp-conflict-actions button {
  padding: 6px 9px;
  border: 1px solid rgba(var(--fg-rgb), 0.16);
  border-radius: 6px;
  background: rgba(var(--fg-rgb), 0.1);
  color: inherit;
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}

.wiz-mcp-conflict-actions button:hover:not(:disabled) {
  background: rgba(var(--fg-rgb), 0.16);
}

.wiz-mcp-conflict-actions button:disabled {
  cursor: default;
  opacity: 0.45;
}

.wiz-link {
  background: none;
  border: none;
  padding: 0;
  color: inherit;
  text-decoration: underline;
  cursor: pointer;
  font: inherit;
}

.wiz-transcript {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 4px 4px 8px;
  /*
   * The host sets `user-select: none` on the widget anchor so a drag never
   * turns into a text selection. That is right for a clock and wrong for a
   * transcript, so the chat takes it back — on the container, not each bubble,
   * or a selection could not span two of them.
   */
  user-select: text;
  cursor: text;
}

/* The requirement, not a caption on it: this replaces the invitation rather
   than sitting above it, so it gets the width and the weight of one. */
.wiz-keygate {
  max-width: 420px;
  margin: auto;
  padding: 4px;
}

.wiz-keygate-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: rgba(var(--fg-rgb), 0.95);
}

.wiz-keygate-lead {
  margin: 6px 0 0;
  font-size: 13px;
  line-height: 1.5;
  color: rgba(var(--fg-rgb), 0.55);
}

.wiz-keygate-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 16px 0 0;
  padding: 0;
  list-style: none;
}

.wiz-keygate-option {
  display: flex;
  width: 100%;
  flex-direction: column;
  gap: 3px;
  padding: 11px 13px;
  border: 1px solid transparent;
  border-radius: 12px;
  background: rgba(var(--fg-rgb), 0.05);
  color: rgba(var(--fg-rgb), 0.92);
  cursor: pointer;
  text-align: left;
}

.wiz-keygate-option:hover,
.wiz-keygate-option:focus-visible {
  background: rgba(var(--fg-rgb), 0.1);
  outline: none;
}

.wiz-keygate-name {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
}

.wiz-keygate-tag {
  padding: 1px 7px;
  border-radius: 999px;
  background: rgba(var(--fg-rgb), 0.12);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: rgba(var(--fg-rgb), 0.6);
}

.wiz-keygate-sub {
  font-size: 11px;
  color: rgba(var(--fg-rgb), 0.45);
}

.wiz-hint {
  margin: 0;
  opacity: 0.5;
  font-size: 11px;
}

.wiz-transcript--empty {
  align-items: center;
  /* Keep the first suggestion reachable when a short card needs scrolling. */
  justify-content: safe center;
}

.wiz-starters {
  flex: 0 0 auto;
  width: 100%;
  max-width: 420px;
  padding: 4px;
}

.wiz-starters-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  line-height: 1.4;
  color: rgba(var(--fg-rgb), 0.92);
}

.wiz-starters-hint {
  margin: 6px 0 16px;
  font-size: 12px;
  line-height: 1.5;
  color: rgba(var(--fg-rgb), 0.55);
}

.wiz-starters-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 120px), 1fr));
  gap: 8px;
}

.wiz-starter {
  padding: 10px 12px;
  border: 1px solid rgba(var(--fg-rgb), 0.1);
  border-radius: 8px;
  background: rgba(var(--fg-rgb), 0.05);
  color: rgba(var(--fg-rgb), 0.85);
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
  transition: background 120ms, border-color 120ms;
}

.wiz-starter:hover:not(:disabled) {
  background: rgba(var(--fg-rgb), 0.1);
  border-color: rgba(var(--fg-rgb), 0.2);
}

.wiz-starter:focus-visible {
  outline: 2px solid rgba(var(--fg-rgb), 0.6);
  outline-offset: 2px;
}

.wiz-starter:disabled {
  opacity: 0.4;
  cursor: default;
}

.wiz-working {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.wiz-working-icon {
  display: inline-flex;
  flex: 0 0 auto;
}

/*
 * The assistant speaks in the page; you speak in a bubble.
 *
 * Only one side is boxed and aligned, which is what makes a transcript readable
 * at a glance: the eye finds your turns by their edge, without two competing
 * shapes to tell apart.
 */
/*
  A turn is the message plus the footnotes about it, stacked and aligned
  together. The bubble keeps whatever ground it has; the footnotes sit under it
  on the page, outside that ground.
*/
.wiz-turn {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.wiz-turn.user {
  align-items: flex-end;
}

.wiz-turn.note {
  align-items: center;
}

.wiz-bubble {
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.5;
}

.wiz-bubble-source {
  display: inline-block;
  vertical-align: -3px;
  margin-right: 5px;
}

.wiz-bubble-source-wrap {
  cursor: help;
}

.wiz-bubble.assistant {
  padding: 0 2px;
}

.wiz-bubble.user {
  max-width: 85%;
  padding: 9px 13px;
  border-radius: 14px;
  background: rgba(var(--fg-rgb), 0.1);
}

/*
  A system bubble that asks something keeps a message's shape: full width, left
  edge, a box you can tell from the page behind it.
*/
.wiz-bubble.system {
  padding: 8px 11px;
  border-radius: 10px;
  background: rgba(220, 160, 90, 0.16);
  font-size: 11px;
}

/* Same green the credential and package panels use for "this worked", so a
   finished step reads as finished instead of as one more amber warning. */
.wiz-bubble.system.success {
  background: rgba(120, 200, 150, 0.16);
  color: rgba(160, 220, 180, 0.95);
}

/*
  A note is not a turn in the conversation, so it stops being drawn as one.

  Opened, updated, renamed, discarded — these report what happened to the
  package, and there are a lot of them. As full-width amber boxes they were the
  loudest thing in a transcript whose subject is the two voices in it, and eight
  of them in a row read as eight warnings. Centred, small and unboxed is the
  shape a transcript already uses for "meanwhile": present, skippable, and
  clearly not something anybody said.

  The ones that ask for a decision keep the rule above — see `isPlainNote`.
*/
.wiz-bubble.system.note {
  /*
    Sized to its text. A 260px floor kept a column of notes from zigzagging,
    but left a short note like "Saved …" floating in a wide empty box.
  */
  max-width: 80%;
  padding: 3px 10px;
  /* Not a pill: these wrap to two lines often enough, and a stadium shape
     around two lines reads as a shape rather than as a note. */
  border-radius: 9px;
  /* Enough ground to be found when looked for, not enough to be read first.
     A note with no ground at all was skippable to the point of invisible. */
  background: rgba(var(--fg-rgb), 0.06);
  color: var(--text-muted, rgba(var(--fg-rgb), 0.55));
  text-align: center;
  text-wrap: balance;
}

.wiz-bubble.system.note.success {
  background: rgba(120, 200, 150, 0.1);
  color: rgba(155, 210, 180, 0.9);
}

/*
  A note's checkpoint appears under the box, in the gap to the next turn,
  instead of reserving a line of its own: a column of notes with an empty line
  under each read as scattered.
*/
.wiz-turn.note {
  position: relative;
}

.wiz-turn.note .wiz-meta {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  margin-top: 0;
  display: flex;
  justify-content: center;
}

.wiz-turn.note .wiz-cp {
  opacity: 0.6;
}

/* A report with one action reads as one line: the sentence, then its button. */
.wiz-bubble.note:has(> .wiz-run-actions) {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 4px 8px;
}

.wiz-bubble.note .wiz-run-actions {
  margin-top: 0;
}

/* One optional button under a report, centred under it like everything else. */
.wiz-bubble.note .wiz-consent-actions {
  flex-wrap: wrap;
  justify-content: center;
  margin-top: 5px;
}

.wiz-bubble.note .wiz-bubble-source {
  vertical-align: -2px;
}

/*
  Not `.wiz-consent-actions`: that is a dialog's row and belongs on the right.
  This is one button with a sentence about it, and the sentence follows it.
*/
.wiz-run-actions {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-top: 8px;
}

.wiz-run-btn {
  height: 20px;
  padding: 0 8px;
  border: none;
  border-radius: 6px;
  background: rgba(var(--fg-rgb), 0.1);
  color: inherit;
  font-size: 11px;
  line-height: 20px;
  cursor: pointer;
}

.wiz-run-btn:hover:not(:disabled) {
  background: rgba(var(--fg-rgb), 0.18);
}

.wiz-run-btn:focus-visible {
  outline: 1px solid rgba(var(--fg-rgb), 0.45);
  outline-offset: 1px;
}

.wiz-run-btn:disabled {
  opacity: 0.55;
  cursor: default;
}

.wiz-consent-list {
  margin: 6px 0 0;
  padding-left: 16px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.wiz-consent-note {
  margin: 6px 0 0;
  opacity: 0.75;
}

.wiz-consent-actions {
  margin-top: 8px;
  display: flex;
  justify-content: flex-end;
}

/*
  One button style for both places it appears.

  The Save row and the buttons inside the conversation — "Add to desk", "Save &
  enable", "Back to this version" — now sit on the same row as each other's
  column, and two sizes of the same kind of control on one line reads as two
  kinds of control. Shared as one selector rather than copied, because a copy
  is a size that drifts the first time either half is touched.
*/
/*
  A checkbox under a consent screen, drawn as the aside it is.

  Deliberately quiet: it is not the answer to the question above it, it is an
  offer to stop being asked. Loud enough to find, never loud enough to be
  mistaken for the decision.
*/
.wiz-auto-approve {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-top: 10px;
  padding-top: 9px;
  border-top: 1px solid rgba(var(--fg-rgb), 0.1);
  font-size: 11px;
  opacity: 0.72;
  cursor: pointer;
}

.wiz-auto-approve:hover {
  opacity: 1;
}

.wiz-auto-approve input {
  margin: 1px 0 0;
  accent-color: rgba(130, 205, 160, 0.9);
  cursor: pointer;
}

.wiz-auto-approve small {
  display: block;
  margin-top: 1px;
  opacity: 0.7;
}

.wiz-consent-btn {
  padding: 4px 12px;
  border-radius: 8px;
  border: 1px solid rgba(var(--fg-rgb), 0.22);
  background: rgba(var(--fg-rgb), 0.1);
  color: inherit;
  font-size: 11px;
  cursor: pointer;
}

.wiz-consent-btn:hover:not(:disabled) {
  background: rgba(var(--fg-rgb), 0.18);
}

.wiz-consent-btn:disabled {
  opacity: 0.55;
  cursor: default;
}

/* Attached images sit above the words, inside the same bubble. */
.wiz-bubble .wiz-thumbs {
  margin-bottom: 8px;
}

.wiz-compose-tools {
  display: flex;
  flex: 0 0 auto;
  align-items: flex-end;
  gap: 8px;
  min-width: 0;
}
.wiz-compose-suggestions { flex: 1; }

.wiz-compose {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 11px 7px;
  border: 1px solid rgba(var(--fg-rgb), 0.14);
  border-radius: 16px;
  background: rgba(var(--fg-rgb), 0.045);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
}

.wiz-composer-editor {
  /* Height is driven by `resizeComposer`; past its cap the box scrolls. */
  min-height: 57px;
  max-height: 160px;
  overflow-y: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font: inherit;
  padding: 2px 3px;
  border: none;
  border-radius: 0;
  outline: none;
  background: transparent;
  color: inherit;
  cursor: text;
}

.wiz-composer-editor:empty::before {
  content: attr(data-placeholder);
  color: rgba(var(--fg-rgb), 0.42);
  pointer-events: none;
}

.wiz-composer-editor:focus {
  outline: none;
}

:global(.wiz-inline-mention) {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  margin: 0 1px;
  padding: 1px 5px 1px 4px;
  border-radius: 6px;
  background: rgba(var(--fg-rgb), 0.1);
  color: inherit;
  vertical-align: baseline;
  line-height: inherit;
  user-select: all;
}

:global(.wiz-inline-mention-mark) {
  display: inline-flex;
  align-self: center;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
}

:global(.wiz-inline-element) {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: min(220px, 100%);
  margin: 0 5px 0 2px;
  padding: 1px 3px 1px 7px;
  border: 1px solid rgba(var(--fg-rgb), 0.14);
  border-radius: 6px;
  background: rgba(var(--fg-rgb), 0.07);
  color: rgba(var(--fg-rgb), 0.9);
  vertical-align: baseline;
  font-size: 0.9em;
  line-height: 1.5;
  user-select: all;
}

:global(.wiz-inline-element__label) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono, monospace);
}

:global(.wiz-inline-element .wiz-inline-element__remove) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 18px;
  width: 18px;
  height: 18px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: rgba(var(--fg-rgb), 0.5);
  font: inherit;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
}

:global(.wiz-inline-element__remove svg) {
  width: 12px;
  height: 12px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
}

:global(.wiz-inline-element__remove:hover),
:global(.wiz-inline-element__remove:focus-visible) {
  background: rgba(var(--fg-rgb), 0.12);
  color: rgba(var(--fg-rgb), 0.95);
}

/*
  Same chip as the composer, a little more fill so it still reads as a chip
  on the user bubble's own 0.1 ground.
*/
.wiz-bubble .wiz-inline-mention {
  background: rgba(var(--fg-rgb), 0.16);
}

.wiz-bubble .wiz-inline-element--history {
  gap: 5px;
  max-width: min(190px, calc(100% - 8px));
  margin: 1px 4px;
  padding: 1px 6px;
  border-color: rgba(var(--fg-rgb), 0.1);
  background: rgba(var(--fg-rgb), 0.065);
  font-size: 0.85em;
  vertical-align: baseline;
}

.wiz-inline-element--history > svg {
  flex-shrink: 0;
  align-self: center;
  opacity: 0.6;
}

.wiz-integrations-menu {
  position: fixed;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  width: min(260px, calc(100% - 16px));
  max-height: 220px;
  overflow-y: auto;
  padding: 4px;
  border: 1px solid rgba(var(--fg-rgb, 255, 255, 255), 0.16);
  border-radius: 10px;
  background: var(--card-bg, rgba(28, 28, 30, 0.98));
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.4);
  /*
   * Teleported onto document.body. The landing page is a light document
   * (`color: var(--ink)`), so inherit would paint the names nearly black on
   * this dark panel, and a light color-scheme would give the list a Windows
   * white scrollbar. The app already has --fg-rgb on html; the fallbacks are
   * for every host that does not.
   */
  color: rgba(var(--fg-rgb, 255, 255, 255), 0.92);
  color-scheme: dark;
  scrollbar-color: rgba(var(--fg-rgb, 255, 255, 255), 0.32) transparent;
}

.wiz-integration-option {
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr) 16px;
  align-items: center;
  gap: 7px;
  width: 100%;
  padding: 7px 8px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.wiz-integration-option:hover,
.wiz-integration-option--active {
  background: rgba(var(--fg-rgb, 255, 255, 255), 0.1);
}

.wiz-compose-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 28px;
}

.wiz-compose-bar :deep(.picker-button) {
  max-width: 240px;
  padding: 4px 5px;
  border: none;
  background: transparent;
  font-size: 12px;
  opacity: 0.8;
}

.wiz-compose-bar :deep(.picker-button:hover:not(:disabled)) {
  background: rgba(var(--fg-rgb), 0.08);
  opacity: 1;
}

.wiz-send {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: rgba(var(--fg-rgb), 0.9);
  color: var(--bg, #111);
  font-size: 0;
  line-height: 1;
  cursor: pointer;
}

.wiz-send::before {
  content: "↑";
  font-size: 16px;
}

.wiz-send:hover:not(:disabled) {
  background: rgba(var(--fg-rgb), 1);
}

/* The composer sits at the bottom of the card: its pickers must float above
   the bar instead of making the host measure a taller widget. */
.wiz-compose-bar :deep(.ssel-panel) {
  top: auto;
  bottom: calc(100% + 4px);
}

.wiz-spacer {
  flex: 1;
}

.wiz-plus {
  position: relative;
}

.wiz-attach {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  font-size: 21px;
  line-height: 1;
  opacity: 0.7;
}

.wiz-attach:hover:not(:disabled) {
  background: rgba(var(--fg-rgb), 0.1);
  opacity: 1;
}

.wiz-plus-menu {
  position: absolute;
  left: 0;
  bottom: calc(100% + 6px);
  z-index: 20;
  padding: 4px;
  border-radius: 9px;
  border: 1px solid rgba(var(--fg-rgb), 0.14);
  background: var(--card-bg, rgba(28, 28, 30, 0.98));
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.4);
  white-space: nowrap;
}

.wiz-plus-item {
  border: none;
  background: none;
  color: inherit;
  font: inherit;
  font-size: 11px;
  padding: 6px 10px;
  border-radius: 6px;
  cursor: pointer;
  width: 100%;
  text-align: left;
}

.wiz-plus-item:hover {
  background: rgba(var(--fg-rgb), 0.1);
}

.wiz-thumbs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.wiz-thumb {
  display: block;
  width: 56px;
  height: 56px;
  object-fit: cover;
  border-radius: 6px;
  border: 1px solid rgba(var(--fg-rgb), 0.14);
}

.wiz-thumb-remove {
  padding: 0;
  border: none;
  background: none;
  cursor: pointer;
  line-height: 0;
}

.wiz-thumb-remove:hover .wiz-thumb {
  opacity: 0.55;
}

/*
  One control with segments rather than a row of words: the faces are
  alternatives, and a track they sit in says so before any of them is read.
  The open one is lifted with the app's selected-row treatment, the same one
  the sidebar uses for the open project.
*/
.wiz-tabs,
.wiz-actions {
  display: flex;
  flex: 0 0 auto;
  gap: 2px;
  padding: 2px;
  border-radius: 9px;
  background: rgba(var(--fg-rgb), 0.06);
}

.wiz-tab,
.wiz-actions :deep(button) {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 24px;
  padding: 0 9px;
  border: none;
  border-radius: 7px;
  background: none;
  color: inherit;
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  opacity: 0.6;
  cursor: pointer;
  transition:
    opacity 120ms ease,
    background-color 120ms ease;
}

.wiz-tab:hover:not(:disabled),
.wiz-actions :deep(button:hover:not(:disabled)) {
  opacity: 1;
}

.wiz-tab:focus-visible,
.wiz-actions :deep(button:focus-visible) {
  outline: 1px solid rgba(var(--fg-rgb), 0.45);
  outline-offset: -1px;
}

.wiz-tab--on {
  background-color: var(--row-selected-bg, rgba(var(--fg-rgb), 0.1));
  background-image: var(--row-selected-sheen, none);
  box-shadow:
    var(--row-selected-rim, inset 0 0 0 1px rgba(255, 255, 255, 0.05)),
    var(--row-selected-shadow, 0 1px 3px rgba(0, 0, 0, 0.3));
  opacity: 1;
}

/*
  The main action, not a selected segment: the raised pill of an open tab made
  Save read as a toggle that was switched on. Flat fill and full ink instead.
*/
.wiz-actions .wiz-action--primary {
  background-color: rgba(var(--fg-rgb), 0.1);
  opacity: 1;
}

.wiz-actions .wiz-action--primary:hover:not(:disabled) {
  background-color: rgba(var(--fg-rgb), 0.16);
}

@container (max-width: 340px) {
  .wiz-tab {
    padding: 0 7px;
  }

  .wiz-tab-label {
    display: none;
  }
}

.wiz-api {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  gap: 10px;
  /* Takes the height the transcript would have had, so switching tabs does not
     resize the column. */
  overflow: auto;
}

.wiz-ep {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid rgba(var(--fg-rgb), 0.12);
  background: rgba(var(--fg-rgb), 0.035);
}

.wiz-api-heading {
  flex: 0 0 auto;
  margin: 2px 0 -4px;
  padding: 0 2px;
  font-size: 11px;
  font-weight: 500;
  color: rgba(var(--fg-rgb), 0.45);
}

.wiz-provider-state {
  margin-left: auto;
  padding: 1px 7px;
  border-radius: 999px;
  background: rgba(var(--fg-rgb), 0.08);
  font-size: 10px;
  line-height: 16px;
  white-space: nowrap;
  color: rgba(var(--fg-rgb), 0.7);
}

.wiz-provider-state--connected {
  background: rgba(90, 205, 130, 0.14);
  color: rgb(90, 190, 125);
}

.wiz-provider-state--disconnected,
.wiz-provider-state--missing {
  background: rgba(218, 164, 89, 0.16);
  color: rgb(205, 150, 70);
}

.wiz-provider-queries {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 2px 0 0;
  padding: 8px 0 0;
  border-top: 1px solid rgba(var(--fg-rgb), 0.08);
  list-style: none;
}

.wiz-provider-queries li {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 8px;
}

.wiz-provider-queries .wiz-ep-desc {
  flex-basis: 100%;
}

.wiz-provider-call {
  font-size: 11px;
  font-weight: 600;
}

.wiz-provider-sub {
  margin: 4px 0 -2px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: rgba(var(--fg-rgb), 0.45);
}

/* Offered by the provider, not called by this widget: there, but quiet. */
.wiz-provider-unused {
  opacity: 0.5;
}

.wiz-provider-badge {
  padding: 0 6px;
  border-radius: 999px;
  background: rgba(90, 205, 130, 0.14);
  color: rgb(90, 190, 125);
  font-size: 10px;
  line-height: 16px;
  white-space: nowrap;
}

.wiz-provider-badge--quiet {
  background: rgba(var(--fg-rgb), 0.08);
  color: rgba(var(--fg-rgb), 0.6);
}

.wiz-provider-badge--warn {
  background: rgba(218, 164, 89, 0.16);
  color: rgb(205, 150, 70);
}

.wiz-provider-result {
  font-size: 11px;
  color: #79b8d1;
}

.wiz-ep-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
}

.wiz-ep-id {
  font-weight: 600;
}

.wiz-ep-meta,
.wiz-ep-desc,
.wiz-ep-note {
  margin: 0;
  font-size: 11px;
  opacity: 0.65;
}

.wiz-ep-args {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.wiz-ep-arg {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 11px;
  /* Grows to fill the row but never forces one: several short parameters
     should sit side by side rather than each taking a line of their own. */
  flex: 1 1 120px;
  min-width: 0;
}

.wiz-ep-arg em {
  font-style: normal;
  opacity: 0.6;
}

.wiz-ep-arg input {
  font: inherit;
  font-size: 11px;
  min-width: 0;
  padding: 4px 6px;
  border-radius: 6px;
  border: 1px solid rgba(var(--fg-rgb), 0.14);
  background: rgba(var(--fg-rgb), 0.05);
  color: inherit;
}

.wiz-ep-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.wiz-ep-error {
  margin: 0;
  font-size: 11px;
  color: var(--kavibay-danger, #f87171);
}

.wiz-ep-body {
  margin: 0;
  max-height: 220px;
  overflow: auto;
  padding: 8px;
  border-radius: 8px;
  background: rgba(var(--fg-rgb), 0.05);
  font-family: ui-monospace, monospace;
  font-size: 10px;
  line-height: 1.45;
  /* A response is mostly long values; wrapped beats a horizontal scrollbar
     inside a box that already scrolls vertically. */
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  user-select: text;
}

/* The panel around it draws the frame; the code is its body. */
.wiz-code {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

/*
 * EVERY METRIC IN THIS RULE IS SHARED ON PURPOSE.
 *
 * The two layers are stacked, so any difference in font, size, line height,
 * padding, box sizing or wrapping shows up as colour drifting away from the
 * text — and it drifts further the lower down the file you read, which is the
 * hardest kind of misalignment to attribute. Change these together or not at
 * all.
 */
.wiz-code-ink,
.wiz-code-edit {
  position: absolute;
  inset: 0;
  margin: 0;
  padding: 9px;
  box-sizing: border-box;
  border: 0;
  font-family: ui-monospace, monospace;
  font-size: 11px;
  line-height: 1.5;
  tab-size: 2;
  /* No soft wrap on either layer. Wrapping would have to break in exactly the
     same places in a textarea and in a `<pre>`, and wherever it did not, the
     colour would slide a whole line out of step. A horizontal scrollbar is the
     cheaper failure, and it is what an editor does anyway. */
  white-space: pre;
}

.wiz-code-ink {
  overflow: hidden;
  pointer-events: none;
  color: rgba(var(--fg-rgb), 0.9);
}

.wiz-code-edit {
  overflow: auto;
  resize: none;
  background: transparent;
  /* The text is invisible; the caret and the selection are all this layer
     draws. `color: transparent` also swallows the placeholder, so that is set
     back explicitly below. */
  color: transparent;
  caret-color: rgba(var(--fg-rgb), 0.9);
  user-select: text;
}

.wiz-code-edit:focus-visible {
  outline: none;
}

.wiz-code-edit::placeholder {
  color: rgba(var(--fg-rgb), 0.4);
}

.wiz-code-edit::selection {
  background: rgba(120, 170, 255, 0.32);
}

/*
 * Dark-only, like the rest of this card. Muted rather than saturated: the
 * editor sits in a translucent overlay, and full-strength syntax colours read
 * as a different application pasted into it.
 */
.tok-comment {
  color: rgba(var(--fg-rgb), 0.42);
  font-style: italic;
}

.tok-string {
  color: #9ec98a;
}

.tok-key {
  color: #79b8d1;
}

.tok-number {
  color: #e0a45e;
}

/* Keywords and `true`/`false`/`null` are both language words, not values. */
.tok-keyword,
.tok-literal {
  color: #c8a2d8;
}

/* HTML tags and CSS selectors: what the structure is made of. */
.tok-tag {
  color: #e0917c;
}

/* An attribute name plays the part a key plays in JSON, so it looks like one. */
.tok-attr {
  color: #79b8d1;
}

.wiz-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 0;
  border-radius: 0;
  background-color: rgba(var(--surface-bg-rgb), var(--surface-alpha, 0.72));
  background-image:
    linear-gradient(rgba(var(--fg-rgb), 0.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(var(--fg-rgb), 0.05) 1px, transparent 1px),
    var(--surface-sheen, linear-gradient(rgba(255, 255, 255, 0), rgba(255, 255, 255, 0)));
  background-size: 20px 20px, 20px 20px, 100% 100%;
  background-repeat: repeat, repeat, no-repeat;
  box-shadow: none;
  backdrop-filter: var(--surface-backdrop-filter, blur(16px));
  color: var(--text-muted, rgba(var(--fg-rgb), 0.55));
}

/*
  Fills the column behind the floating actions. Keep the stage's stacking
  context below the toolbar, including its iframe and backdrop layers.
*/
.wiz-preview-body {
  isolation: isolate;
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.wiz-preview-body > * {
  flex: 1 1 auto;
  min-height: 0;
}

/* Flush with the column top, the same line the Chat/Code tabs sit on. */
.wiz-actions {
  position: absolute;
  top: 0;
  right: 0;
  z-index: 1;
  justify-content: flex-end;
  flex-wrap: wrap;
  max-width: 100%;
  box-sizing: border-box;
  backdrop-filter: blur(12px);
}

button {
  font: inherit;
  padding: 5px 10px;
  border-radius: 6px;
  border: 1px solid rgba(var(--fg-rgb), 0.14);
  background: rgba(var(--fg-rgb), 0.08);
  color: inherit;
  cursor: pointer;
}

button:disabled {
  opacity: 0.4;
  cursor: default;
}
.wiz-accounts {
  position: relative;
  font-size: 12px;
}

.wiz-accounts > summary {
  display: flex;
  align-items: center;
  gap: 5px;
  cursor: pointer;
  padding: 4px 6px;
  border: none;
  border-radius: 6px;
  background: transparent;
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  opacity: 0.6;
  list-style: none;
}

.wiz-accounts > summary::-webkit-details-marker {
  display: none;
}

.wiz-accounts > summary:hover,
.wiz-accounts[open] > summary {
  background: rgba(var(--fg-rgb), 0.08);
  opacity: 1;
}

/*
  Green once the widget reads from something, exactly as the dot it replaced
  was. The state is worth a glance and the icon is already there; a dot beside
  it would be a second element saying the same word.
*/
.wiz-accounts:not(.wiz-accounts--standalone) .wiz-accounts-icon {
  color: rgba(130, 205, 160, 0.95);
}

.wiz-accounts-icon {
  flex: 0 0 auto;
}

/* Only the names truncate; the icon and the caret keep their size. */
.wiz-accounts-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wiz-accounts > ul {
  position: absolute;
  bottom: calc(100% + 4px);
  left: 0;
  z-index: 5;
  min-width: 260px;
  margin: 0;
  padding: 6px;
  list-style: none;
  border: 1px solid var(--kavibay-border, rgba(255, 255, 255, 0.15));
  border-radius: 8px;
  background: var(--kavibay-surface, #1b1b1b);
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.3);
}

.wiz-account-item {
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr) 16px;
  gap: 8px;
  align-items: center;
  width: 100%;
  padding: 6px 7px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.wiz-account-item:hover,
.wiz-account-item:focus-visible {
  background: rgba(var(--fg-rgb), 0.1);
  outline: none;
}

.wiz-account-item:disabled {
  cursor: default;
}

.wiz-account-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wiz-account-name--offline {
  opacity: 0.55;
}

/*
  Far-right slot, same column as the check. Click opens Settings on that
  credential; the rest of the row still toggles selection.
*/
.wiz-account-offline {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  opacity: 0.45;
  cursor: pointer;
}

.wiz-account-offline:hover {
  opacity: 0.85;
}

.wiz-account-check {
  width: 16px;
  color: rgba(160, 220, 180, 0.95);
  font-size: 14px;
  font-weight: 600;
  line-height: 16px;
  text-align: center;
}
.wiz-filesview {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  gap: 8px;
}

/*
 * Reserved, then revealed.
 *
 * `visibility`/`opacity` rather than `display`, because the height has to be
 * spoken for whether or not anything is showing: a row that appears on hover
 * pushes the rest of the transcript down, and the message under the pointer is
 * the one thing that must hold still.
 *
 * `:focus-within` as well as `:hover` — the checkpoint is a real button, and
 * one reachable only by pointer is one a keyboard cannot reach at all. It stays
 * tabbable while invisible (`pointer-events` is what is switched off, not
 * focusability), so tabbing to it reveals the row it lives in.
 */
.wiz-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 120ms ease;
}

.wiz-turn:hover .wiz-meta,
.wiz-meta:focus-within {
  opacity: 1;
  pointer-events: auto;
}

/* Touch and pen have no hover, so the footnotes would never be reachable. */
@media (hover: none) {
  .wiz-meta {
    opacity: 1;
    pointer-events: auto;
  }
}

.wiz-usage-mark,
.wiz-cp-btn {
  display: inline-flex;
  align-items: center;
  box-sizing: border-box;
  height: 22px;
}

.wiz-usage-mark {
  flex: 0 0 auto;
  justify-content: center;
  width: 22px;
  border-radius: 4px;
  opacity: 0.6;
  cursor: help;
}

.wiz-usage-mark:hover,
.wiz-usage-mark:focus-visible {
  opacity: 1;
}

.wiz-usage-mark:focus-visible {
  outline: 1px solid currentColor;
  outline-offset: 2px;
}


.wiz-cp {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 10px;
  opacity: 0.6;
}

.wiz-cp-dot {
  /* Green rather than the transcript's amber: this is a statement of fact, not
     something waiting to be acted on. */
  color: #6ea86e;
  font-size: 8px;
}

.wiz-cp-btn {
  gap: 5px;
  padding: 0 7px;
  font-size: 10px;
  line-height: 1;
  white-space: nowrap;
  border-radius: 999px;
}

.wiz-cp-icon {
  flex: 0 0 auto;
}

.wiz-versions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  flex: 0 0 auto;
}

.wiz-version {
  display: flex;
  align-items: baseline;
  gap: 5px;
  padding: 2px 7px;
  font-size: 10px;
  border-radius: 999px;
  opacity: 0.75;
}

.wiz-version:disabled {
  /* The live one. Dimmed like any other disabled control would read as
     unavailable, which is the opposite of what it is — so it is the
     emphasised one instead. */
  opacity: 1;
  background: rgba(232, 232, 234, 0.16);
  cursor: default;
}

.wiz-version-at {
  opacity: 0.55;
}

.wiz-version-source {
  flex: none;
  align-self: center;
}

.wiz-files {
  display: flex;
  flex: 1;
  min-height: 0;
  /* Takes the height the transcript would have had, so switching tabs does not
     resize the column. */
  overflow: hidden;
  border: 1px solid rgba(var(--fg-rgb), 0.12);
  border-radius: 10px;
  background: rgba(var(--fg-rgb), 0.035);
}

.wiz-files:has(.wiz-code-edit:focus) {
  border-color: rgba(var(--fg-rgb), 0.26);
}

.wiz-filetree {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  width: clamp(120px, 32%, 190px);
  padding: 8px 6px;
  box-sizing: border-box;
  border-right: 1px solid rgba(var(--fg-rgb), 0.08);
  overflow: auto;
}

.wiz-filetree-heading {
  margin: 0 0 4px;
  padding: 0 6px;
  font-size: 11px;
  font-weight: 500;
  color: rgba(var(--fg-rgb), 0.45);
}

.wiz-filelist {
  display: flex;
  flex-direction: column;
  gap: 1px;
  margin: 0;
  padding: 0;
  list-style: none;
}

/* Each level of folder indents by one icon plus its gap, so a file's icon sits
   under its folder's name. */
.wiz-filerow {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  height: 24px;
  padding: 0 6px 0 calc(6px + var(--depth, 0) * 19px);
  box-sizing: border-box;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 12px;
  text-align: left;
  white-space: nowrap;
}

.wiz-filerow--folder {
  color: rgba(var(--fg-rgb), 0.55);
}

.wiz-filebtn {
  color: rgba(var(--fg-rgb), 0.78);
  cursor: pointer;
  transition: background-color 100ms ease;
}

.wiz-filebtn:hover {
  background: var(--fill, rgba(var(--fg-rgb), 0.08));
  color: rgba(var(--fg-rgb), 0.95);
}

.wiz-filebtn:focus-visible {
  outline: 1px solid rgba(var(--fg-rgb), 0.45);
  outline-offset: -1px;
}

.wiz-filebtn--on,
.wiz-filebtn--on:hover {
  background-color: var(--row-selected-bg, rgba(var(--fg-rgb), 0.1));
  background-image: var(--row-selected-sheen, none);
  box-shadow:
    var(--row-selected-rim, inset 0 0 0 1px rgba(255, 255, 255, 0.05)),
    var(--row-selected-shadow, 0 1px 3px rgba(0, 0, 0, 0.3));
  color: rgba(var(--fg-rgb), 0.95);
}

.wiz-filename {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

/*
  One colour per kind of file, mid-tone so it reads on the dark card and the
  light one alike, and only on the icon: the names stay the text colour, so the
  list is a column of names with a coloured mark rather than a rainbow.
*/
.wiz-fileicon {
  flex: 0 0 auto;
}

.wiz-fileicon--json {
  color: rgb(212, 158, 64);
}

.wiz-fileicon--markup {
  color: rgb(224, 116, 84);
}

.wiz-fileicon--script {
  color: rgb(198, 170, 48);
}

.wiz-fileicon--style {
  color: rgb(86, 146, 226);
}

.wiz-fileicon--image {
  color: rgb(164, 116, 214);
}

.wiz-fileicon--text,
.wiz-fileicon--folder {
  color: rgba(var(--fg-rgb), 0.55);
}

.wiz-fileedit {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
}

.wiz-filepath {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 4px;
  height: 32px;
  padding: 0 12px;
  border-bottom: 1px solid rgba(var(--fg-rgb), 0.08);
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
}

.wiz-filepath > .wiz-fileicon {
  margin-right: 3px;
}

.wiz-filepath-dir {
  color: rgba(var(--fg-rgb), 0.5);
}

.wiz-filepath-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 500;
}

.wiz-filenote {
  margin: 0;
  padding: 8px 12px 0;
  font-size: 11px;
  opacity: 0.7;
}
.wiz-tab-count {
  min-width: 15px;
  padding: 0 4px;
  border-radius: 999px;
  background: rgba(var(--fg-rgb), 0.1);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  line-height: 15px;
  text-align: center;
  box-sizing: border-box;
}

.wiz-tab:disabled,
.wiz-actions :deep(button:disabled) {
  opacity: 0.3;
  cursor: default;
}
.wiz-grip {
  position: relative;
  cursor: col-resize;
  border-radius: 3px;
  /* Invisible until touched — a permanent divider in a transparent overlay
     reads as a border somebody drew. */
  background: transparent;
  transition: background-color 120ms;
}

.wiz-grip:hover,
.wiz-grip:focus-visible {
  background: rgba(232, 232, 234, 0.14);
  outline: none;
}

/*
  Folded away, the divider has no width to set. It only holds the way back,
  level with the header rather than halfway down the edge where it used to be
  a tab nobody looked for.
*/
.wiz-grip.wiz-c2--sidebar-collapsed,
.wiz-grip.wiz-c2--sidebar-collapsed:hover,
.wiz-grip.wiz-c2--sidebar-collapsed:focus-visible {
  background: transparent;
  cursor: default;
}

.wiz-side-expand {
  position: absolute;
  top: 2px;
  left: -13px;
}

</style>
