import type { InstanceDataStore } from "./data-store";
import type { PackageFormat } from "../runtime/runtimeTypes";
import { runtimeStorageKey } from "../runtime/runtimeStorage";

/** A draft changes where code is loaded from, not which preview owns its data. */
export function wizardPreviewIdentity(extId: string) {
  const packageId = extId.replace(/^__draft__/, "");
  return {
    packageId,
    instanceId: `wizard-preview-${packageId}`,
    legacyDraftInstanceId: `wizard-preview-__draft__${packageId}`,
  };
}

/** Move old draft cells once, so deleting a value cannot resurrect it on reopen. */
export function migrateWizardPreviewData(
  extId: string,
  format: PackageFormat,
  data: InstanceDataStore,
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
) {
  const { packageId, instanceId, legacyDraftInstanceId } = wizardPreviewIdentity(extId);
  if (format === "contract") {
    data.clone(legacyDraftInstanceId, instanceId);
    data.evict(legacyDraftInstanceId);
    return;
  }
  const target = runtimeStorageKey(packageId, instanceId);
  const legacy = runtimeStorageKey(`__draft__${packageId}`, legacyDraftInstanceId);
  const saved = storage.getItem(legacy);
  if (saved === null) return;
  if (storage.getItem(target) === null) storage.setItem(target, saved);
  storage.removeItem(legacy);
}
