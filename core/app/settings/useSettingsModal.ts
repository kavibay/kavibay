import { ref, type Ref } from "vue";

export type SettingsSectionId =
  | "appearance"
  | "behavior"
  | "search"
  | "files"
  | "extensions"
  | "ai"
  | "credentials"
  | "mcp";

const open: Ref<boolean> = ref(false);
const section: Ref<SettingsSectionId> = ref("appearance");
/** Registry type id to select on the Credentials panel, or null. */
const credentialType: Ref<string | null> = ref(null);
/** Catalog provider id to select on the AI panel, or null. */
const aiProvider: Ref<string | null> = ref(null);

/** Shared open state for the app Settings modal. */
export function useSettingsModal() {
  function show() {
    section.value = "appearance";
    credentialType.value = null;
    aiProvider.value = null;
    open.value = true;
  }

  function showSection(targetSection: SettingsSectionId, focus?: string) {
    section.value = targetSection;
    credentialType.value = targetSection === "credentials" ? (focus ?? null) : null;
    aiProvider.value = targetSection === "ai" ? (focus ?? null) : null;
    open.value = true;
  }

  function hide() {
    open.value = false;
  }

  return { open, section, credentialType, aiProvider, show, showSection, hide };
}
