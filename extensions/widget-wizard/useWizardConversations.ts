import { onScopeDispose, ref, type Ref } from "vue";
import type { WizardCapability, WidgetDataStore } from "@sdk/contract/sdk";
import {
  conversationIsWorthKeeping,
  conversationTitle,
  emptyWizardSession,
  parseWizardSession,
  trimWizardSession,
  type ConversationHeader,
  type WizardSession,
} from "./widgetWizardLogic";

interface StoredConversation {
  id: string;
  title: string;
  updatedAt: number;
  payload: unknown;
}

const ACTIVE_CONVERSATION_KEY = "activeConversationId";

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
  let draftTimer: ReturnType<typeof setTimeout> | undefined;

  async function rememberActive(id: string): Promise<void> {
    await data.set(ACTIVE_CONVERSATION_KEY, id).catch(() => undefined);
  }

  async function hydrate(): Promise<void> {
    const id = await data.get<string>(ACTIVE_CONVERSATION_KEY).catch(() => undefined);
    if (!id) return;
    const loaded = await load(id);
    if (loaded) active.value = loaded;
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
      return { ...session, id: stored.id };
    } catch {
      return null;
    }
  }

  async function save(session: WizardSession): Promise<void> {
    await rememberActive(session.id);
    if (!session.id || !conversationIsWorthKeeping(session)) return;
    const trimmed = trimWizardSession(session);
    try {
      await wizard.conversationSave({
        id: trimmed.id,
        title: conversationTitle(trimmed),
        updatedAt: Date.now(),
        payload: trimmed,
      });
      await refresh();
    } catch {
      // In-memory work remains available when durable storage is unavailable.
    }
  }

  async function remove(id: string): Promise<void> {
    try {
      await wizard.conversationDelete(id);
    } finally {
      await refresh();
    }
  }

  onScopeDispose(() => {
    clearTimeout(draftTimer);
    void save(active.value);
  });

  return {
    headers,
    active,
    hydrate,
    refresh,
    start,
    load,
    save,
    saveDraftSoon,
    remove,
  };
}
