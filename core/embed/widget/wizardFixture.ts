import type { WidgetCapabilityTransport } from "../../app/extension-host/widgetCapabilityTransport";
import { DEMO_MODELS } from "./wizardScript";
import { currentWizardDemo } from "./wizardDemos";

/**
 * The Widget Wizard's capability, answered from a script.
 *
 * WHY THE WIZARD GETS A FIXTURE WHEN EVERY OTHER CAPABILITY GETS A REFUSAL:
 *
 * The rest of `browserCapabilityTransport` throws, because a browser cannot
 * read a clipboard and pretending otherwise would put a fabricated screenshot
 * on a marketing page. The Wizard is different in kind: what it shows is a
 * *conversation*, and a conversation can be replayed honestly. No model is
 * called, no key exists on this page, and nothing is written to disk — the
 * draft store below lives in memory and dies with the tab.
 *
 * The page that mounts this must say so. A visitor who believes they just
 * watched a model write a widget, when they watched a recording, has been
 * misled by the demo rather than informed by it.
 *
 * WHAT IS REAL HERE ANYWAY:
 *
 * Everything except the answers. The component is the shipping
 * `WidgetWizardWidget.vue`, the conversation state is its own, the reply is
 * parsed by the shipping `parseGeneratedFiles`, and the files below are a
 * package that would really load. That is the point: the demo cannot drift
 * from the product, because it *is* the product with a scripted correspondent.
 */

interface DraftEntry {
  id: string;
  files: { path: string; contents: string }[];
  revision: string;
}

/** In memory, per tab. A demo that outlived its tab would be a promise. */
const drafts = new Map<string, DraftEntry>();

/**
 * The files a draft holds right now, for the preview to assemble a document
 * from. Exported because the preview is the one reader outside this file —
 * and because reading them is all it may do.
 */
export function demoDraftFiles(id: string): { path: string; contents: string }[] {
  return drafts.get(id)?.files ?? [];
}

/** Which scripted reply comes next. Per tab, like the drafts. */
let turn = 0;

/**
 * Back to before the demo ran, so it can run again.
 *
 * Replay closes the Wizard's card, which unmounts the component and takes its
 * conversation with it — but not what the *host* remembers. The draft would
 * still be there, and the reply counter would hand the second turn's answer to
 * the first question. Clearing both here is the whole reset: conversations are
 * already stateless in this fixture (`wizardConversationsList` answers with an
 * empty list and `…Save` keeps nothing), which is what makes a second run
 * indistinguishable from the first.
 */
export function resetWizardFixture(): void {
  drafts.clear();
  turn = 0;
}

let revisionCounter = 0;
const nextRevision = () => `demo-${(revisionCounter += 1)}`;

/** Long enough to read as work, short enough not to feel broken. */
const THINKING_MS = 900;
let thinkingMs = THINKING_MS;

/** The landing's tour plays at a chosen pace; the "model" thinks at it too. */
export function setWizardThinkingPace(factor: number): void {
  thinkingMs = THINKING_MS * factor;
}
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function summarize(entry: DraftEntry) {
  return {
    id: entry.id,
    files: entry.files.map((file) => file.path),
    revision: entry.revision,
    error: null,
  };
}

/**
 * Refused writes that a demo must not appear to perform.
 *
 * Promoting installs a widget, and there is nothing here to install into.
 * Saying so beats a success reply that leaves the person looking for a widget
 * that was never created.
 */
function notInDemo(action: string): never {
  throw new Error(`${action} is not part of this demo — it would install into a desktop app`);
}

export const wizardFixture: Pick<
  WidgetCapabilityTransport,
  | "wizardModels"
  | "wizardComplete"
  | "wizardConversationsList"
  | "wizardConversationLoad"
  | "wizardConversationSave"
  | "wizardConversationDelete"
  | "wizardRuntimeScan"
  | "wizardRuntimeInstalls"
  | "wizardRuntimeEntryUrl"
  | "wizardRuntimeSetEnabled"
  | "wizardRuntimeReadPackage"
  | "wizardRuntimeDeletePackage"
  | "wizardExportPackage"
  | "wizardEndpointCall"
  | "wizardDrafts"
  | "wizardDraftRead"
  | "wizardDraftOpen"
  | "wizardOnDraftChanged"
  | "wizardDraftPresence"
  | "wizardOnDraftPresenceChanged"
  | "wizardDraftWrite"
  | "wizardDraftPromote"
  | "wizardDraftDiscard"
> = {
  wizardModels: async () => DEMO_MODELS,

  /**
   * The next scripted answer, whatever was asked.
   *
   * By turn, not by question: a demo that answers two sentences correctly and
   * everything else with silence is worse than one that is plainly a
   * recording, and the page says what this is. Past the end it repeats the
   * last reply rather than going quiet.
   */
  wizardComplete: async (request) => {
    await delay(thinkingMs);
    const replies = currentWizardDemo().replies;
    const text = replies[Math.min(turn, replies.length - 1)]!;
    turn += 1;
    return {
      text,
      provider: "anthropic",
      model: request.model,
      usage: { inputTokens: 1840, outputTokens: 620 },
    };
  },

  // Conversations: this tab starts empty and keeps nothing.
  wizardConversationsList: async () => [],
  wizardConversationLoad: async () => null,
  wizardConversationSave: async () => {},
  wizardConversationDelete: async () => {},

  // Nothing is installed on a web page, and nothing can be.
  wizardRuntimeScan: async () => [],
  wizardRuntimeInstalls: async () => [],
  /**
   * A signal, not a location.
   *
   * `previewUrl` gates the whole preview stage: an empty string is falsy, so
   * the Wizard rendered "Your widget will appear here" no matter how many
   * files the draft held. It must be non-empty.
   *
   * What it points at does not matter here, because `EmbedWizardPreview.vue`
   * assembles the document from the draft's files rather than fetching this —
   * a browser has no `kavibay-ext://` scheme to serve it from. The made-up
   * scheme says so out loud instead of dressing up as an http URL nobody
   * would be able to open.
   */
  wizardRuntimeEntryUrl: (id: string, entry: string) => `kavibay-embed-preview://${id}/${entry}`,
  wizardRuntimeSetEnabled: async () => notInDemo("Enabling a widget"),
  wizardRuntimeReadPackage: async () => null,
  wizardRuntimeDeletePackage: async () => {},
  /**
   * A page has no save dialog to raise and no package folder to read, and the
   * files this demo holds only ever existed in memory. Refusing says that;
   * a `null` here would read as "you cancelled", which nobody did.
   */
  wizardExportPackage: async () => {
    throw new Error(
      "Exporting a widget is not part of this demo — the files it would zip up live in the desktop app",
    );
  },

  wizardEndpointCall: async () => notInDemo("Calling a declared endpoint"),

  // Drafts round-trip in memory so the editor behaves; they reach no disk.
  wizardDrafts: async () => [...drafts.values()].map(summarize),
  /**
   * A missing draft is **refused**, not answered with `null`.
   *
   * The distinction is not pedantic — it decides what the Wizard believes.
   * `expectedDraftRevision` reads the draft and, if the read does not throw
   * while this conversation holds no draft, concludes the id belongs to
   * somebody else and reports `draft_exists`. Answering `null` therefore told
   * the visitor "a draft called water-tracker already exists" on a page where
   * nothing existed at all.
   */
  wizardDraftRead: async (id: string) => {
    const entry = drafts.get(id);
    if (!entry) throw new Error(`draft_not_found:${id}`);
    return { ...entry, error: null, lastWriter: "wizard", updatedAt: Date.now() };
  },
  wizardDraftOpen: async (id: string) => {
    const entry = drafts.get(id) ?? { id, files: [], revision: nextRevision() };
    drafts.set(id, entry);
    return { ...summarize(entry), created: true };
  },
  wizardDraftWrite: async (id: string, files: unknown) => {
    const entry = {
      id,
      files: Array.isArray(files) ? (files as DraftEntry["files"]) : [],
      revision: nextRevision(),
    };
    drafts.set(id, entry);
    return summarize(entry);
  },
  wizardDraftDiscard: async (id: string) => {
    drafts.delete(id);
  },
  wizardDraftPromote: async () => notInDemo("Saving a widget"),

  // No second writer exists here, so nothing ever changes behind the editor.
  wizardOnDraftChanged: async () => () => {},
  wizardDraftPresence: async () => [],
  wizardOnDraftPresenceChanged: async () => () => {},
};
