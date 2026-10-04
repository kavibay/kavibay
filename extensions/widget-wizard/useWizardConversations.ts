import { onScopeDispose, ref, watch, type Ref } from "vue";
import type { WizardCapability, WidgetDataStore } from "@sdk/contract/sdk";
import {
  conversationIsWorthKeeping,
  conversationTitle,
  emptyWizardSession,
  parseWizardSession,
  trimWizardSession,
  type ConversationHeader,
  type ProjectRow,
  type WizardSession,
} from "./widgetWizardLogic";

interface StoredConversation {
  id: string;
  title: string;
  updatedAt: number;
  payload: unknown;
}

/** Opening notes and refreshed widget files are not conversation activity. */
function conversationContent(session: WizardSession): string {
  return JSON.stringify([
    session.draft,
    session.attachments,
    session.bubbles.filter((bubble) => bubble.role !== "system"),
  ]);
}

const ACTIVE_CONVERSATION_KEY = "activeConversationId";
/**
 * The project on screen, remembered beside the conversation.
 *
 * A project that is only open — a draft an MCP client wrote, a widget opened
 * to look at — has no conversation worth keeping (`conversationIsWorthKeeping`),
 * so the active conversation id names a file that never gets written. Without
 * this the next start could not load it and fell back to "New project".
 */
const ACTIVE_PACKAGE_KEY = "activePackageId";

/** Ids are file names on the other side, so keep them to plain characters. */
function newConversationId(): string {
  const raw =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return raw.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
}

/**
 * Conversation files remain backend-owned because a turn can contain a large
 * screenshot. `ctx.data` stores only which conversation is active, so a widget
 * remount survives without putting megabytes into the instance quota.
 */
export function useWizardConversations(wizard: WizardCapability, data: WidgetDataStore) {
  const headers: Ref<ConversationHeader[]> = ref([]);
  const active: Ref<WizardSession> = ref(emptyWizardSession(newConversationId()));
  const savedContent = new Map<string, { content: string; updatedAt: number }>();
  const deletedIds = new Set<string>();
  let writeQueue = Promise.resolve();
  let draftTimer: ReturnType<typeof setTimeout> | undefined;
  /** Set by `hydrate` when the conversation is gone but its project is not. */
  let pendingPackageId: string | null = null;

  watch(
    () => active.value.packageId ?? "",
    (packageId) => void data.set(ACTIVE_PACKAGE_KEY, packageId).catch(() => undefined),
  );

  async function rememberActive(id: string): Promise<void> {
    await data.set(ACTIVE_CONVERSATION_KEY, id).catch(() => undefined);
  }

  async function hydrate(): Promise<void> {
    const id = await data.get<string>(ACTIVE_CONVERSATION_KEY).catch(() => undefined);
    const loaded = id ? await load(id) : null;
    if (loaded) {
      active.value = loaded;
      return;
    }
    const packageId = await data.get<string>(ACTIVE_PACKAGE_KEY).catch(() => undefined);
    pendingPackageId = packageId || null;
  }

  /** The project to reopen because its conversation was never kept; asked once. */
  function takePendingPackage(): string | null {
    const id = pendingPackageId;
    pendingPackageId = null;
    return id;
  }

  async function refresh(): Promise<ConversationHeader[]> {
    try {
      headers.value = await wizard.conversationsList<ConversationHeader[]>();
    } catch {
      headers.value = [];
    }
    return headers.value;
  }

  function start(): WizardSession {
    clearTimeout(draftTimer);
    active.value = emptyWizardSession(newConversationId());
    void rememberActive(active.value.id);
    return active.value;
  }

  function saveDraftSoon(session: WizardSession) {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => void save(session), 1000);
  }

  async function load(id: string): Promise<WizardSession | null> {
    try {
      const stored = await wizard.conversationLoad<StoredConversation | null>(id);
      if (!stored) return null;
      const session = parseWizardSession(JSON.stringify(stored.payload));
      savedContent.set(stored.id, {
        content: conversationContent(session),
        updatedAt: stored.updatedAt,
      });
      return { ...session, id: stored.id };
    } catch {
      return null;
    }
  }

  function save(session: WizardSession): Promise<void> {
    const writing = writeQueue.then(() => persist(session));
    writeQueue = writing.catch(() => undefined);
    return writing;
  }

  async function persist(session: WizardSession): Promise<void> {
    if (deletedIds.has(session.id)) return;
    await rememberActive(session.id);
    if (deletedIds.has(session.id) || !session.id || !conversationIsWorthKeeping(session)) return;
    const trimmed = trimWizardSession(session);
    const content = conversationContent(trimmed);
    const previous = savedContent.get(trimmed.id);
    const updatedAt = previous?.content === content ? previous.updatedAt : Date.now();
    try {
      await wizard.conversationSave({
        id: trimmed.id,
        title: conversationTitle(trimmed),
        updatedAt,
        payload: trimmed,
      });
      savedContent.set(trimmed.id, { content, updatedAt });
      await refresh();
    } catch {
      // In-memory work remains available when durable storage is unavailable.
    }
  }

  async function remove(id: string): Promise<void> {
    if (!id) return;
    // Finish an in-flight write before deleting; later autosaves must stay deleted.
    deletedIds.add(id);
    try {
      await writeQueue;
      await wizard.conversationDelete(id);
      savedContent.delete(id);
      if (active.value.id === id) start();
    } catch (error) {
      deletedIds.delete(id);
      throw error;
    } finally {
      await refresh();
    }
  }

  /** Remove every source that could rebuild this widget's sidebar row. */
  async function removeWidget(
    row: Pick<ProjectRow, "packageId" | "saved" | "draft" | "conversationIds">,
  ): Promise<void> {
    await writeQueue;
    const stored = await wizard.conversationsList<ConversationHeader[]>();
    const ids = new Set(row.conversationIds);
    if (row.packageId) {
      for (const header of stored) {
        if (header.packageId === row.packageId) ids.add(header.id);
      }
      if (active.value.packageId === row.packageId) ids.add(active.value.id);
      if (row.saved) await wizard.runtimeDeletePackage(row.packageId);
      if (row.draft) await wizard.draftDiscard(row.packageId);
    }
    for (const id of ids) await remove(id);
  }

  onScopeDispose(() => {
    clearTimeout(draftTimer);
    void save(active.value);
  });

  return {
    headers,
    active,
    hydrate,
    takePendingPackage,
    refresh,
    start,
    load,
    save,
    saveDraftSoon,
    remove,
    removeWidget,
  };
}
