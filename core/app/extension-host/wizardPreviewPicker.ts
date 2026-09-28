import { inject, onBeforeUnmount, onMounted, provide, watch, type InjectionKey, type Ref } from "vue";
import type { WizardPreviewElement } from "@sdk/wizardPreview";
import { readPreviewPick } from "./previewPickerProtocol";

interface PreviewPicker {
  picking: Readonly<Ref<boolean>>;
  select: (element: WizardPreviewElement) => void;
  cancel: () => void;
}
const pickerKey: InjectionKey<PreviewPicker> = Symbol("wizard-preview-picker");

export function provideWizardPreviewPicker(picker: PreviewPicker): PreviewPicker | undefined {
  if (!import.meta.env.DEV) return undefined;
  provide(pickerKey, picker);
  return picker;
}

/** Only descendants of the Wizard preview receive the opt-in context. */
export function useWizardPreviewPicker(
  frame: Ref<HTMLIFrameElement | null>,
  runId: Readonly<Ref<string>>,
  picker = inject(pickerKey, undefined),
): boolean {
  if (!import.meta.env.DEV || !picker) return false;
  const context = picker;
  let token: string | null = null;

  function sync() {
    token = context.picking.value ? crypto.randomUUID() : null;
    frame.value?.contentWindow?.postMessage({ type: "kavibay.preview.pick", token }, "*");
  }
  function onMessage(event: MessageEvent) {
    const frameWindow = frame.value?.contentWindow;
    if (!frameWindow || event.source !== frameWindow) return;
    if (event.data?.type === "kavibay.preview.ready") {
      sync();
      return;
    }
    const pick = readPreviewPick(event, frameWindow, context.picking.value ? token : null);
    if (!pick) return;
    if (pick.type === "selected") context.select(pick.element);
    else {
      token = null;
      context.cancel();
    }
  }
  watch(context.picking, sync, { flush: "sync" });
  watch(runId, () => {
    token = null;
    context.cancel();
  }, { flush: "sync" });
  onMounted(() => window.addEventListener("message", onMessage));
  onBeforeUnmount(() => {
    token = null;
    window.removeEventListener("message", onMessage);
  });
  return true;
}
