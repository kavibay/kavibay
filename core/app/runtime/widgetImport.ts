/**
 * Installing a widget from a zip: one flow behind a file dropped onto Kavibay
 * and the palette's "Import Widget" command.
 *
 * Rust unpacks and scans the archive first, and the dialog shows that scan.
 * "Install widget" then installs exactly what was shown and grants what it
 * listed, in one step. Asking again on enable would be the same list a second
 * time, and a list people confirm twice is one they stop reading.
 */
import { ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { paletteDropActive } from "../palette/inlineWidgetRequest";
import { setClickThroughPaused } from "../system/clickThrough";
import type { ContractGrant } from "./runtimeInstallLogic";
import type { ScannedRuntimeExtension } from "./runtimeTypes";
import { useRuntimeExtensions } from "./useRuntimeExtensions";
import { describeImportError, fileNameOf, firstZip } from "./widgetImportLogic";

export interface ImportPreview {
  token: string;
  fileName: string;
  package: ScannedRuntimeExtension;
}

export type ImportState =
  | { kind: "idle" }
  | { kind: "reading"; fileName: string }
  | { kind: "review"; preview: ImportPreview }
  | { kind: "installing"; preview: ImportPreview }
  | { kind: "failed"; fileName: string; message: string };

export const importState = ref<ImportState>({ kind: "idle" });

/** Bumped per archive, so a slow read cannot replace the dialog of a newer drop. */
let generation = 0;

export async function importFromPath(path: string): Promise<void> {
  const current = ++generation;
  const fileName = fileNameOf(path);
  importState.value = { kind: "reading", fileName };
  try {
    const preview = await invoke<ImportPreview>("runtime_extensions_import_inspect", { path });
    if (current === generation) importState.value = { kind: "review", preview };
  } catch (error) {
    if (current !== generation) return;
    importState.value = { kind: "failed", fileName, message: describeImportError(String(error)) };
  }
}

/** The palette command: the same flow, from the open dialog. */
export async function pickAndImport(): Promise<void> {
  // The dialog covers the transparent window; its buttons must not read as a
  // click on the desktop underneath, which would hide the app mid-pick.
  setClickThroughPaused(true);
  let picked: string | null;
  try {
    picked = await open({
      title: "Import widget",
      multiple: false,
      directory: false,
      filters: [{ name: "Widget archive", extensions: ["zip"] }],
    });
  } finally {
    setClickThroughPaused(false);
  }
  if (picked) await importFromPath(picked);
}

/**
 * Install what the dialog showed, turn it on with the grant it listed, and put
 * it on the desk. `contractGrant` is what the person ticked for a widget that
 * reads from accounts; a runtime package's grant is computed in Rust from its
 * manifest, exactly as the Settings "Enable" button does.
 */
export async function installReviewed(contractGrant?: ContractGrant): Promise<void> {
  const state = importState.value;
  if (state.kind !== "review") return;
  const { preview } = state;
  importState.value = { kind: "installing", preview };
  const fail = (code: string) => {
    importState.value = { kind: "failed", fileName: preview.fileName, message: describeImportError(code) };
  };
  try {
    const id = await invoke<string>("runtime_extensions_import_install", { token: preview.token });
    const runtime = useRuntimeExtensions();
    await runtime.rescan();
    if (!(await runtime.setEnabled(id, true, contractGrant))) return fail("enable_refused");
    window.dispatchEvent(new CustomEvent("kavibay:run-runtime-widget", { detail: { typeId: id } }));
    importState.value = { kind: "idle" };
  } catch (error) {
    fail(String(error));
  }
}

export function cancelImport(): void {
  const state = importState.value;
  if (state.kind === "installing") return;
  if (state.kind === "review") {
    void invoke("runtime_extensions_import_discard", { token: state.preview.token }).catch(() => {
      // The next import clears the staging folder anyway.
    });
  }
  generation++;
  importState.value = { kind: "idle" };
}

/**
 * Files dragged in from the OS. Only Tauri's native event reaches the app; the
 * webview never sees an HTML5 drop. Click-through makes Kavibay's visible
 * surfaces the only place a drop can land, so no position test is needed.
 */
export function listenForDroppedWidgets(): Promise<UnlistenFn> {
  return getCurrentWebview().onDragDropEvent(({ payload }) => {
    if (payload.type === "enter") {
      paletteDropActive.value = firstZip(payload.paths) !== undefined;
    } else if (payload.type === "leave") {
      paletteDropActive.value = false;
    } else if (payload.type === "drop") {
      paletteDropActive.value = false;
      const zip = firstZip(payload.paths);
      if (zip) void importFromPath(zip);
    }
  });
}
