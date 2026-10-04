import { effectScope } from "vue";
import type { WidgetDataStore, WizardCapability } from "@sdk/contract/sdk";
import { useWizardConversations } from "./useWizardConversations";
import { buildProjectRows, emptyWizardSession, type WizardSession } from "./widgetWizardLogic";

function assertEq(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) throw new Error(message);
}

const originalNow = Date.now;
let now = 10_000;
Date.now = () => now;

const stored = new Map<string, {
  id: string;
  title: string;
  updatedAt: number;
  payload: WizardSession;
}>();
for (const id of ["first", "second"]) {
  const payload = emptyWizardSession(id);
  payload.bubbles.push({ role: "user", text: `Build ${id}` });
  stored.set(id, { id, title: `Build ${id}`, updatedAt: 1_000, payload });
}
let failSave = false;
let failDelete = false;
let writeGate: Promise<void> | undefined;
let writeStarted: (() => void) | undefined;
const packages = new Set<string>();
const drafts = new Set<string>();
const wizard = {
  conversationsList: async () => [...stored.values()].map(({ payload, ...header }) => ({
    ...header,
    packageId: payload.packageId,
  })),
  conversationLoad: async (id: string) => structuredClone(stored.get(id) ?? null),
  conversationSave: async (value: unknown) => {
    if (failSave) throw new Error("storage unavailable");
    writeStarted?.();
    await writeGate;
    const conversation = value as NonNullable<ReturnType<typeof stored.get>>;
    stored.set(conversation.id, JSON.parse(JSON.stringify(conversation)));
  },
  conversationDelete: async (id: string) => {
    if (failDelete) throw new Error("delete unavailable");
    stored.delete(id);
  },
  runtimeDeletePackage: async (id: string) => {
    if (!packages.delete(id)) throw new Error("package_not_found");
    drafts.delete(id);
  },
  draftDiscard: async (id: string) => { drafts.delete(id); },
} as unknown as WizardCapability;
const cells = new Map<string, unknown>();
const data: WidgetDataStore = {
  get: async <T>(key: string) => cells.get(key) as T | undefined,
  set: async <T>(key: string, value: T) => { cells.set(key, value); },
  delete: async (key: string) => { cells.delete(key); },
};
const scope = effectScope();
const conversations = scope.run(() => useWizardConversations(wizard, data))!;

try {
  const first = (await conversations.load("first"))!;
  conversations.active.value = first;
  // The same changes openWidget makes while restoring an existing conversation.
  first.model = "default-model";
  first.widgetName = "First widget";
  first.draftFiles = [{ path: "index.html", contents: "refreshed files" }];
  first.bubbles.push({ role: "system", opened: true, text: "Opened draft" });
  await conversations.save(first);
  assertEq(stored.get("first")!.updatedAt, 1_000, "opening preserves the timestamp");
  assertEq(stored.get("first")!.payload.draftFiles![0]!.contents, "refreshed files",
    "restored widget state still persists");

  const second = (await conversations.load("second"))!;
  await conversations.save(first);
  conversations.active.value = second;
  await conversations.save(second);
  assertEq(stored.get("first")!.updatedAt, 1_000, "leaving does not mark a conversation active");
  assertEq(stored.get("second")!.updatedAt, 1_000, "switching preserves the opened timestamp");

  second.draft = "Add a counter";
  await conversations.save(second);
  assertEq(stored.get("second")!.updatedAt, now, "typing is new activity");
  now = 20_000;
  await conversations.save(second);
  assertEq(stored.get("second")!.updatedAt, 10_000, "saving unchanged content keeps its time");

  second.draft = "";
  second.bubbles.push({ role: "user", text: "Add a counter" });
  await conversations.save(second);
  assertEq(stored.get("second")!.updatedAt, now, "sending a message updates its time");
  now = 30_000;
  second.bubbles.push({ role: "assistant", text: "Added a counter" });
  await conversations.save(second);
  assertEq(stored.get("second")!.updatedAt, now, "a response updates its time");

  now = 40_000;
  const reopened = (await conversations.load("second"))!;
  await conversations.save(reopened);
  assertEq(stored.get("second")!.updatedAt, 30_000, "reloading keeps the durable timestamp");
  reopened.draft = "Another change";
  failSave = true;
  await conversations.save(reopened);
  failSave = false;
  await conversations.save(reopened);
  assertEq(stored.get("second")!.updatedAt, now, "failed writes do not swallow activity on retry");

  conversations.active.value = reopened;
  now = 50_000;
  scope.stop();
  // Scope disposal persists asynchronously, just like hiding the Wizard.
  await conversations.save(reopened);
  assertEq(stored.get("second")!.updatedAt, 40_000, "closing preserves the last content time");
} finally {
  scope.stop();
  Date.now = originalNow;
}

const deletionScope = effectScope();
const deletions = deletionScope.run(() => useWizardConversations(wizard, data))!;
const rows = () => buildProjectRows({
  widgets: [...packages].map((id) => ({ id, name: id })),
  drafts: [...drafts].map((id) => ({ id, error: null, lastWriter: "wizard" as const })),
  conversations: deletions.headers.value,
});

try {
  // Deleting one widget removes every source of its row and leaves other widgets alone.
  packages.add("water");
  drafts.add("water");
  stored.get("first")!.payload.packageId = "water";
  const sibling = { ...emptyWizardSession("sibling"), packageId: "water" };
  sibling.bubbles.push({ role: "user", text: "Add a daily goal" });
  stored.set(sibling.id, { id: sibling.id, title: "Daily goal", updatedAt: 1_000, payload: sibling });
  const active = (await deletions.load("first"))!;
  deletions.active.value = active;
  deletions.saveDraftSoon(active);
  await deletions.refresh();
  const water = rows().find((row) => row.packageId === "water")!;
  // A stale sidebar row may not yet include a second stored conversation.
  await deletions.removeWidget({ ...water, conversationIds: ["first"] });
  assertEq(rows().some((row) => row.packageId === "water"), false, "one deletion removes the entire widget row");
  assertEq(stored.has("sibling"), false, "all related conversations are deleted, including uncached ones");
  assertEq(stored.has("second"), true, "unrelated conversations survive");
  assertEq(deletions.active.value.packageId, null, "the active preview is reset");
  await deletions.save(active);
  assertEq(stored.has("first"), false, "a stale autosave cannot recreate the deleted widget");

  // Draft-only and conversation-only rows are fully removed through the same action.
  for (const packageId of ["draft-only", ""]) {
    const session = emptyWizardSession(packageId || "idea");
    session.packageId = packageId || null;
    session.bubbles.push({ role: "user", text: "Build a widget" });
    if (packageId) drafts.add(packageId);
    deletions.active.value = session;
    await deletions.save(session);
    const row = rows().find((item) => item.conversationIds.includes(session.id))!;
    await deletions.removeWidget(row);
    assertEq(rows().some((item) => item.key === row.key), false, "deleting an unsaved row removes it entirely");
  }

  // A write already crossing the bridge must finish before the delete reaches storage.
  const second = (await deletions.load("second"))!;
  deletions.active.value = second;
  let releaseWrite!: () => void;
  writeGate = new Promise<void>((resolve) => { releaseWrite = resolve; });
  const entered = new Promise<void>((resolve) => { writeStarted = resolve; });
  const saving = deletions.save(second);
  await entered;
  const removing = deletions.remove(second.id);
  releaseWrite();
  await Promise.all([saving, removing]);
  writeGate = undefined;
  writeStarted = undefined;
  await deletions.save(second);
  assertEq(stored.has("second"), false, "neither an in-flight nor a later save resurrects a deletion");

  const retry = emptyWizardSession("retry");
  retry.bubbles.push({ role: "user", text: "Keep my work if deleting fails" });
  deletions.active.value = retry;
  await deletions.save(retry);
  failDelete = true;
  let failed = false;
  try { await deletions.remove(retry.id); } catch { failed = true; }
  failDelete = false;
  assertEq(failed, true, "deletion errors are reported");
  retry.draft = "Continue editing";
  await deletions.save(retry);
  assertEq(stored.get(retry.id)!.payload.draft, retry.draft, "a failed deletion does not disable future saves");
  await deletions.remove(retry.id);
  assertEq(stored.size, 0, "deletion can be retried successfully");
} finally {
  deletionScope.stop();
}

console.log("useWizardConversations.assert.ts: ok");
