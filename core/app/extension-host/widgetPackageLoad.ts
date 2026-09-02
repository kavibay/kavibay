import type { ExtensionRegistry } from "./registry";
import { WidgetPackageError, widgetPackageManifest, type ApprovedGrant } from "./widgetPackage";

/**
 * Turns scanned packages plus stored grants into loaded extensions.
 *
 * This is the step that was missing between "the package is on disk and enabled"
 * and "the host can mount it". The registry knew how to load a package manifest
 * and `widgetPackageManifest` knew how to build one from a grant; nothing joined
 * the two, so a package listed as ready, enabled, and then rendered nothing.
 *
 * The rule the whole file exists to keep is negative: **a package without a
 * stored grant does not load.** Not with an empty permission list, not with the
 * manifest's own list, not "for now". `widgetPackageManifest` takes the grant as
 * a required argument precisely so this decision cannot be made by forgetting,
 * and this is the caller that would otherwise have made it.
 */

/** Just enough of a scan row to decide. Kept structural so the assert file can build one. */
export interface WidgetPackageRow {
  id: string;
  status: string;
  format: string;
  contractManifest?: unknown;
}

/** Just enough of an install record to decide. */
export interface WidgetPackageInstall {
  id: string;
  enabled: boolean;
  /**
   * Both shapes are accepted, and only one is written.
   *
   * `providers` is the current shape. `provider` + `queries` is what records
   * written before a widget could name more than one provider look like, and
   * they are on disk in `installs.json` on machines that already ran this. A
   * package whose stored grant stopped parsing would not fail loudly — it would
   * load with nothing granted and render empty, which is the failure this whole
   * file exists to stop producing.
   */
  contractGrant?: StoredGrant | null;
}

export interface StoredGrant {
  /** Current shape: which accounts the person approved. */
  approved?: string[];
  /**
   * Two older shapes, read and never written. Both carried per-query grants,
   * which no longer exist — the provider names are kept and the query lists
   * dropped, because approving a provider is now the wider of the two answers
   * and re-asking someone a question they already answered more narrowly is
   * the interruption `askedNothingNew` exists to avoid.
   */
  providers?: { provider: string; queries: string[] }[];
  provider?: string;
  queries?: string[];
}

/** What loading one package produced, for the frame that has to mount it. */
interface Loaded {
  extensionId: string;
  definitionId: string;
  /** What was loaded, so an unchanged package is not torn down and rebuilt. */
  signature: string;
}

/**
 * Why a package the user enabled is not showing a widget.
 *
 * Carried rather than logged: an enabled package that renders nothing is the
 * exact failure this whole chain kept producing, and every round of it cost a
 * debugging session because the reason was in a console nobody had open.
 */
export interface WidgetPackageRefusal {
  id: string;
  reason: string;
}

const signatureOf = (raw: unknown, grant: ApprovedGrant): string =>
  JSON.stringify({ raw, providers: grant.providers });

/**
 * The grant, from the install record and nowhere else.
 *
 * `actions` is filled in here as empty rather than read: the stored shape has no
 * actions field at all (see `ContractGrant` in `installs.rs`), so there is
 * nothing to copy and no way for one to arrive.
 */
function grantOf(install: WidgetPackageInstall): ApprovedGrant | undefined {
  const stored = install.contractGrant;
  if (!stored) return undefined;

  const approved =
    stored.approved ??
    stored.providers?.map((row) => row.provider) ??
    (stored.provider ? [stored.provider] : []);
  return { providers: [...approved] };
}

export class WidgetPackageLoader {
  private loaded = new Map<string, Loaded>();
  private refusals = new Map<string, string>();

  constructor(private registry: ExtensionRegistry) {}

  /**
   * Brings the registry in line with what is on disk and approved.
   *
   * Idempotent by signature: a package whose manifest and grant are unchanged is
   * left alone, so a rescan does not tear down a mounted widget. Anything else —
   * a withdrawn grant, a disabled package, a deleted folder, a re-approval with
   * different boxes ticked — is unloaded and, where it still applies, loaded
   * again.
   */
  sync(rows: readonly WidgetPackageRow[], installs: readonly WidgetPackageInstall[]): void {
    const refusals = new Map<string, string>();
    const wanted = new Map<string, { raw: unknown; grant: ApprovedGrant; signature: string }>();

    for (const row of rows) {
      if (row.format !== "contract") continue;
      const install = installs.find((record) => record.id === row.id);
      // Not enabled is not a refusal. The user turned it off; there is nothing
      // to explain and no widget on screen to explain it to.
      if (!install?.enabled) continue;

      if (row.status !== "ready") {
        refusals.set(row.id, "the package did not scan cleanly");
        continue;
      }
      const grant = grantOf(install);
      if (!grant) {
        refusals.set(
          row.id,
          "this widget has not been approved yet — enable it again to choose what it may read",
        );
        continue;
      }
      /**
       * Asked here rather than left to the linker, which would answer
       * "missing dependency kavibay.tado" — naming a dependency nobody wrote,
       * because the loader derives it. Somebody reading that goes looking in
       * the manifest for a block that is not there, which is finding 21's
       * lesson about a message naming the wrong thing.
       */
      const missing = grant.providers.filter((pid) => !this.registry.providers.has(pid));
      if (missing.length > 0) {
        // Every missing one, not the first: fixing them one refusal at a time
        // is the same wait shown as several surprises.
        refusals.set(
          row.id,
          `this widget reads from ${missing.join(", ")}, which ${missing.length === 1 ? "is" : "are"} not installed`,
        );
        continue;
      }
      wanted.set(row.id, {
        raw: row.contractManifest,
        grant,
        signature: signatureOf(row.contractManifest, grant),
      });
    }

    for (const [id, entry] of [...this.loaded]) {
      if (wanted.get(id)?.signature === entry.signature) continue;
      this.registry.unload(entry.extensionId);
      this.loaded.delete(id);
    }

    for (const [id, entry] of wanted) {
      if (this.loaded.has(id)) continue;
      const failure = this.load(id, entry.raw, entry.grant, entry.signature);
      if (failure) refusals.set(id, failure);
    }

    // Linking is the fifth reader of a manifest, and the one nobody counted.
    // A package's widget names a provider it does not own, which the linker
    // refuses unless the manifest declares a dependency on the owner — so
    // `widgetPackageManifest` derives that dependency from the approved
    // provider. Run here rather than per package: a link is a statement about
    // the whole set.
    const before = this.registry.errors.length;
    const failed = new Set(this.registry.link());
    const linkErrors = this.registry.errors.slice(before);
    for (const [id, entry] of [...this.loaded]) {
      if (!failed.has(entry.extensionId)) continue;
      this.loaded.delete(id);
      refusals.set(
        id,
        linkErrors.find((error) => error.startsWith(entry.extensionId)) ??
          "the widget could not be linked against its provider",
      );
    }

    this.refusals = refusals;
  }

  /** The definition to mount for a package, or undefined when it did not load. */
  definitionOf(packageId: string): string | undefined {
    return this.loaded.get(packageId)?.definitionId;
  }

  /**
   * A value that changes exactly when the mounted widget has to start over.
   *
   * `setup` runs once, in the guest's own document, and reads its permissions
   * and configuration at that moment. So a widget approved for one more query
   * while it is on screen would go on showing what it built without that access
   * — the bridge would allow the call, and nobody would ever make it. Keying the
   * mount on this is what turns a re-approval into a reload.
   *
   * Deliberately not the definition id: that is the same string before and after
   * a re-approval, which is the case this exists for.
   */
  mountKeyOf(packageId: string): string | undefined {
    const entry = this.loaded.get(packageId);
    return entry && `${entry.definitionId}#${entry.signature}`;
  }

  /** Why an enabled package is not mounting, in a sentence a person can act on. */
  refusalOf(packageId: string): string | undefined {
    return this.refusals.get(packageId);
  }

  /** Every enabled package that is not mounting, for a settings list. */
  allRefusals(): WidgetPackageRefusal[] {
    return [...this.refusals].map(([id, reason]) => ({ id, reason }));
  }

  /** Loads one package. Returns a refusal reason, or undefined on success. */
  private load(
    id: string,
    raw: unknown,
    grant: ApprovedGrant,
    signature: string,
  ): string | undefined {
    let manifest;
    try {
      manifest = widgetPackageManifest(raw, grant);
    } catch (error) {
      // A `WidgetPackageError` is the package being refused on its merits and
      // its message is written for a person; anything else is a bug here.
      return error instanceof WidgetPackageError ? error.message : String(error);
    }

    const before = this.registry.errors.length;
    const extensionId = this.registry.load(manifest, {
      kind: "generated",
      // The package id. `builderSessionId` wants to say which run produced this,
      // and a package on disk has outlived whatever session wrote it — the
      // directory is the most honest answer still available.
      builderSessionId: id,
    });
    if (!extensionId) {
      return this.registry.errors.slice(before)[0] ?? "the registry refused this package";
    }

    const widget = manifest.contributes.widgets?.[0];
    if (!widget) return "the package contributes no widget";
    this.loaded.set(id, {
      extensionId,
      definitionId: `${extensionId}/${widget.name}`,
      signature,
    });
    return undefined;
  }
}
