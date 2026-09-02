/**
 * Public registry surface for host, palette, and other core consumers.
 * Backed by Vite-glob discovery in loadExtensions.ts.
 */
export {
  listExtensions,
  getExtension,
  searchExtensions,
  runExtensionHook,
  runExtensionAction,
  runDuplicateHook,
} from "./loadExtensions";

export { instanceStorageKey, createInstanceStore } from "@sdk";
export type { InstanceStoreOptions } from "@sdk";
export type {
  ActionArgs,
  ActionParam,
  ExtensionAction,
  ExtensionActionContext,
  ExtensionManifest,
  ExtensionModule,
  RegisteredExtension,
} from "@sdk";
