import { ref, type Ref } from "vue";

export type SettingsSectionId =
  | "appearance"
  | "behavior"
  | "files"
  | "extensions"
  | "ai"
  | "credentials"
  | "mcp"
  | "tado";

const open: Ref<boolean> = ref(false);
const section: Ref<SettingsSectionId> = ref("appearance");
/** Registry type id to select on the Credentials panel, or null. */
const credentialType: Ref<string | null> = ref(null);

/** Shared open state for the app Settings modal. */
export function useSettingsModal() {
  function show() {
    section.value = "appearance";
    credentialType.value = null;
    open.value = true;
  }

  function showSection(targetSection: SettingsSectionId, focusCredentialType?: string) {
    section.value = targetSection;
    credentialType.value =
      targetSection === "credentials" ? (focusCredentialType ?? null) : null;
    open.value = true;
  }

  function hide() {
    open.value = false;
  }

  return { open, section, credentialType, show, showSection, hide };
}
