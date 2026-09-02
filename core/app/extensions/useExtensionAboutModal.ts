import { computed, ref } from "vue";

export interface ExtensionAboutContent {
  title: string;
  readme: string;
  /** Effective UI values of the concrete instance that opened About. */
  ui: {
    defaultOffset: { x: number; y: number };
    defaultSize: { w: number; h: number };
    defaultScale: number;
    defaultHideTitle: boolean;
  };
}

const content = ref<ExtensionAboutContent | null>(null);

/**
 * Counts `show` calls so a README arriving late cannot overwrite the dialog
 * that has since been closed or reopened for a different extension.
 */
let showGeneration = 0;

/** Shared state for the host-owned About dialog of bundled extensions. */
export function useExtensionAboutModal() {
  const open = computed(() => content.value !== null);

  /**
   * Open the dialog. `loadReadme` (see RegisteredExtension) is awaited in the
   * background rather than before opening: the chunk is local and lands within
   * a frame or two, and a dialog that appears instantly with its heading beats
   * one that waits for prose.
   */
  function show(next: ExtensionAboutContent, loadReadme?: () => Promise<string>) {
    content.value = next;
    if (!loadReadme) return;

    const generation = ++showGeneration;
    void loadReadme()
      .then((readme) => {
        if (generation !== showGeneration || !content.value) return;
        content.value = { ...content.value, readme };
      })
      .catch(() => {
        // Missing README is not an error worth surfacing — the dialog still
        // shows title and layout values, which is most of what it is for.
      });
  }

  function hide() {
    showGeneration++;
    content.value = null;
  }

  return { content, open, show, hide };
}
