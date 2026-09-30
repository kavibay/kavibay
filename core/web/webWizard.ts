import { DEMO_HOME } from "../embed/palette/demoFiles";
import { demoDraftFiles, wizardFixture } from "../embed/widget/wizardFixture";

/**
 * The Widget Wizard's commands, answered in the page.
 *
 * The conversation comes from the same scripted correspondent the embed demo
 * uses (`wizardFixture.ts`): the Wizard is the shipping component, only its
 * model is a recording, and drafts live in memory. The page that shows this
 * must say it is a recording — see the fixture's own note.
 *
 * Saving is real enough to run a contract package: Save installs the draft's
 * files into an in-memory package folder, the scan reports it the way Rust
 * would, and the approval the Wizard asks for lands on its install record. A
 * saved Linear/GitHub widget therefore loads through the app's own contract
 * path — grant, registry, sandboxed frame — with its providers answered by
 * `webProviders.ts`. Nothing survives the tab.
 *
 * The preview that loads either one is in `webWizardPreview.ts`.
 */

type Args = Record<string, unknown>;

interface PackageFile {
  path: string;
  contents: string;
}

interface InstallRecord {
  id: string;
  enabled: boolean;
  grantedPermissions: string[];
  apiHash: null;
  contractGrant?: unknown;
}

/** Saved packages: id → files. What Rust keeps under ~/.kavibay/widgets/custom. */
const installed = new Map<string, PackageFile[]>();
const installs = new Map<string, InstallRecord>();

/** Files behind a package id: a saved package first, else the draft of that name. */
export function packageFiles(id: string): PackageFile[] {
  return installed.get(id) ?? demoDraftFiles(id);
}

function manifestOf(files: PackageFile[]): Record<string, unknown> {
  try {
    const raw = files.find((file) => file.path === "manifest.json")?.contents ?? "{}";
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * One package as `runtime_extensions_scan` describes it (runtimeTypes.ts).
 * The format comes from the manifest's `widget` object, as Rust derives it.
 */
function scanRow(id: string, files: PackageFile[]) {
  const manifest = manifestOf(files);
  const contract = typeof manifest.widget === "object" && manifest.widget !== null;
  const ui = (manifest.ui ?? {}) as { entry?: string; defaultSize?: { w: number; h: number } };
  return {
    id,
    name: String(manifest.displayName ?? manifest.name ?? id),
    version: String(manifest.version ?? "0.0.0"),
    description: typeof manifest.description === "string" ? manifest.description : null,
    path: [DEMO_HOME, ".kavibay", "widgets", "custom", id].join("\\"),
    uiEntry: contract ? "index.html" : (ui.entry ?? "index.html"),
    updatedAt: Date.now(),
    icon: null,
    permissions: contract ? [] : ((manifest.permissions as string[] | undefined) ?? []),
    commands: [],
    apiEndpoints: [],
    apiHash: null,
    origin: "custom",
    format: contract ? "contract" : "runtime",
    ...(contract ? { contractManifest: manifest } : {}),
    ...(ui.defaultSize ? { defaultSize: ui.defaultSize } : {}),
    status: "ready",
    error: null,
  };
}

export const WIZARD_ANSWERS: Record<string, (args: Args) => unknown> = {
  wizard_models: (args) => wizardFixture.wizardModels(String(args.instanceId ?? "")),
  wizard_complete: ({ instanceId, ...request }) =>
    wizardFixture.wizardComplete(
      request as unknown as Parameters<typeof wizardFixture.wizardComplete>[0],
      String(instanceId ?? ""),
    ),
  wizard_conversations_list: () => wizardFixture.wizardConversationsList(),
  wizard_conversation_load: (args) => wizardFixture.wizardConversationLoad(String(args.id)),
  wizard_conversation_save: (args) => wizardFixture.wizardConversationSave(args.conversation),
  wizard_conversation_delete: (args) => wizardFixture.wizardConversationDelete(String(args.id)),

  runtime_extensions_draft_list: () => wizardFixture.wizardDrafts(),
  runtime_extensions_draft_read: (args) => wizardFixture.wizardDraftRead(String(args.id)),
  runtime_extensions_draft_open: (args) => wizardFixture.wizardDraftOpen(String(args.id)),
  runtime_extensions_draft_write: (args) =>
    wizardFixture.wizardDraftWrite(String(args.id), args.files, (args.expectedRevision as string) ?? null),
  runtime_extensions_draft_discard: (args) => wizardFixture.wizardDraftDiscard(String(args.id)),

  /** Save: the draft becomes a package, and the draft is gone. */
  runtime_extensions_draft_promote: async (args) => {
    const id = String(args.id);
    const files = demoDraftFiles(id);
    if (files.length === 0) throw new Error(`draft_not_found:${id}`);
    installed.set(id, files.map((file) => ({ ...file })));
    const replaces = typeof args.replaces === "string" ? args.replaces : null;
    if (replaces && replaces !== id) {
      installed.delete(replaces);
      installs.delete(replaces);
    }
    await wizardFixture.wizardDraftDiscard(id);
    return id;
  },
  runtime_extensions_scan: () => [...installed].map(([id, files]) => scanRow(id, files)),
  runtime_extensions_installs_list: () => [...installs.values()],
  /** Enable (or disable) with the grant the person just gave; answers with every record. */
  runtime_extensions_installs_set: (args) => {
    const id = String(args.id);
    installs.set(id, {
      id,
      enabled: args.enabled === true,
      grantedPermissions: Array.isArray(args.manifestPermissions)
        ? (args.manifestPermissions as string[])
        : [],
      apiHash: null,
      ...(args.contractGrant ? { contractGrant: args.contractGrant } : {}),
    });
    return [...installs.values()];
  },
  runtime_extensions_read_package: (args) => installed.get(String(args.id)) ?? null,
  runtime_extensions_delete_package: (args) => {
    installed.delete(String(args.id));
    installs.delete(String(args.id));
    return null;
  },
  // No second writer (an MCP client) exists on a page.
  mcp_draft_presence: () => wizardFixture.wizardDraftPresence(),
};
