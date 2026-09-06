// SPDX-License-Identifier: MIT
import { onScopeDispose, ref, watch, type Ref } from "vue";
import {
  defineWidget,
  type LlmChatRequest,
  type LlmStreamEvent,
  type WidgetActionContext,
  type WidgetContext,
  type WidgetDataStore,
} from "@sdk/contract/sdk";
import {
  clampOnePurposeSize,
  createCustomPurposeTemplate,
  DEFAULT_ONE_PURPOSE_SETTINGS,
  findPurpose,
  normalizeCustomPurposeTemplates,
  normalizeHiddenPurposeIds,
  normalizeOnePurposeSettings,
  ONE_PURPOSE_PURPOSES,
  settingsForDuplicate,
  sortModels,
  type CustomPurposeTemplate,
  type LlmModelOption,
  type OnePurposeLlmSettings,
} from "../onePurposeLlmLogic";

export const ONE_PURPOSE_STATE_KEY = "state";
export const ONE_PURPOSE_TEMPLATES_KEY = "customTemplates";
export const ONE_PURPOSE_HIDDEN_KEY = "hiddenPurposeIds";
export const onePurposeLlmModelRevision = ref(0);

export interface OnePurposeLlmModel {
  settings: Ref<OnePurposeLlmSettings>;
  customTemplates: Ref<CustomPurposeTemplate[]>;
  hiddenTemplateIds: Ref<string[]>;
  models: Ref<LlmModelOption[]>;
  update(values: Partial<OnePurposeLlmSettings>): void;
  setPrompt(prompt: string): void;
  resetPrompt(): void;
  setPurpose(purposeId: string): void;
  createTemplate(template: CustomPurposeTemplate): void;
  deleteTemplate(templateId: string): void;
  clearText(): void;
  setSize(width: number, height: number): void;
  loadModels(): Promise<void>;
  stream(
    request: LlmChatRequest,
    onEvent: (event: LlmStreamEvent) => void,
  ): Promise<void>;
  cancel(requestId: string): Promise<void>;
}

const liveModels = new Map<string, OnePurposeLlmModel>();
const pendingInputFocus = new Set<string>();

const sharedTemplates = ref<CustomPurposeTemplate[]>([]);
const sharedHiddenTemplateIds = ref<string[]>([]);
let sharedStore: WidgetDataStore | undefined;
let sharedHydration: Promise<void> | undefined;
let sharedPersistence = Promise.resolve();

function hydrateSharedData(ctx: WidgetContext): Promise<void> {
  if (!sharedHydration) {
    sharedStore = ctx.sharedData;
    sharedHydration = Promise.all([
      sharedStore?.get<unknown>(ONE_PURPOSE_TEMPLATES_KEY),
      sharedStore?.get<unknown>(ONE_PURPOSE_HIDDEN_KEY),
    ]).then(([templates, hidden]) => {
      sharedTemplates.value = normalizeCustomPurposeTemplates(templates);
      sharedHiddenTemplateIds.value = normalizeHiddenPurposeIds(hidden);
    });
  }
  return sharedHydration;
}

function persistShared(key: string, value: unknown): void {
  if (!sharedStore) return;
  sharedPersistence = sharedPersistence
    .catch(() => undefined)
    .then(() => sharedStore!.set(key, value));
}

export function onePurposeLlmModelForInstance(instanceId: string): OnePurposeLlmModel | undefined {
  // Read for the dependency, not the value.
  void onePurposeLlmModelRevision.value;
  return liveModels.get(instanceId);
}

export function requestOnePurposeLlmInputFocus(instanceId: string): void {
  pendingInputFocus.add(instanceId);
}

export function consumeOnePurposeLlmInputFocus(instanceId: string): boolean {
  return pendingInputFocus.delete(instanceId);
}

function purposeIdFromAction(
  template: string,
  customTemplates: CustomPurposeTemplate[],
): string | undefined {
  const normalized = template.trim().toLowerCase();
  const shipped = ONE_PURPOSE_PURPOSES.find(
    (purpose) => purpose.id === template || purpose.label.toLowerCase() === normalized,
  );
  if (shipped) return shipped.id;
  return customTemplates.find((item) => item.id === template)?.id;
}

/** Palette action; works before the target widget is mounted. */
export async function runUseTemplateAction({
  ctx,
  args,
}: WidgetActionContext<Record<string, never>>): Promise<void> {
  const customTemplates = normalizeCustomPurposeTemplates(
    await ctx.sharedData?.get<unknown>(ONE_PURPOSE_TEMPLATES_KEY),
  );
  const hiddenTemplateIds = normalizeHiddenPurposeIds(
    await ctx.sharedData?.get<unknown>(ONE_PURPOSE_HIDDEN_KEY),
  );
  const purposeId = purposeIdFromAction(args.template ?? "", customTemplates);
  if (!purposeId || !findPurpose(purposeId, customTemplates, hiddenTemplateIds)) {
    throw new Error(`unknown template: "${args.template ?? ""}"`);
  }

  const current = normalizeOnePurposeSettings(
    await ctx.data.get<OnePurposeLlmSettings>(ONE_PURPOSE_STATE_KEY),
  );
  const next = normalizeOnePurposeSettings({
    ...current,
    purposeId,
    ...(args.text !== undefined ? { input: args.text, anonymized: [], output: "" } : {}),
  });
  await ctx.data.set(ONE_PURPOSE_STATE_KEY, next);
  const live = liveModels.get(ctx.instanceId);
  if (live) live.settings.value = next;
  requestOnePurposeLlmInputFocus(ctx.instanceId);
}

export function duplicateOnePurposeData(key: string, value: unknown): unknown {
  return key === ONE_PURPOSE_STATE_KEY
    ? settingsForDuplicate(normalizeOnePurposeSettings(value))
    : value;
}

export const onePurposeLlmWidget = defineWidget<Record<string, never>>({
  name: "one-purpose-llm",
  displayName: "Single Purpose AI",
  description: "Run a focused writing task with a provider-neutral LLM.",
  defaultSize: { w: 5.3, h: 4.7 },
  minSize: { w: 2.2, h: 2.9 },
  mode: "both",
  capabilities: { llm: true },
  duplicateData: true,
  duplicateDataTransform: duplicateOnePurposeData,
  actions: { "use-template": runUseTemplateAction },
  component: {
    async setup(ctx: WidgetContext<Record<string, never>>): Promise<OnePurposeLlmModel> {
      const settings = ref<OnePurposeLlmSettings>({ ...DEFAULT_ONE_PURPOSE_SETTINGS });
      const models = ref<LlmModelOption[]>([]);
      const model: OnePurposeLlmModel = {
        settings,
        customTemplates: sharedTemplates,
        hiddenTemplateIds: sharedHiddenTemplateIds,
        models,
        update(values) {
          settings.value = normalizeOnePurposeSettings({ ...settings.value, ...values });
        },
        setPrompt(prompt) {
          model.update({ prompts: { ...settings.value.prompts, [settings.value.purposeId]: prompt } });
        },
        resetPrompt() {
          const prompts = { ...settings.value.prompts };
          delete prompts[settings.value.purposeId];
          model.update({ prompts });
        },
        setPurpose(purposeId) {
          model.update({
            purposeId: findPurpose(purposeId, sharedTemplates.value, sharedHiddenTemplateIds.value).id,
            output: "",
          });
        },
        createTemplate(template) {
          if (sharedTemplates.value.some((item) => item.id === template.id)) return;
          sharedTemplates.value = normalizeCustomPurposeTemplates([
            ...sharedTemplates.value,
            template,
          ]);
          persistShared(ONE_PURPOSE_TEMPLATES_KEY, { templates: sharedTemplates.value });
          model.setPurpose(template.id);
        },
        deleteTemplate(templateId) {
          if (sharedTemplates.value.some((item) => item.id === templateId)) {
            sharedTemplates.value = sharedTemplates.value.filter((item) => item.id !== templateId);
            persistShared(ONE_PURPOSE_TEMPLATES_KEY, { templates: sharedTemplates.value });
          } else {
            sharedHiddenTemplateIds.value = normalizeHiddenPurposeIds([
              ...sharedHiddenTemplateIds.value,
              templateId,
            ]);
            persistShared(ONE_PURPOSE_HIDDEN_KEY, sharedHiddenTemplateIds.value);
          }
          if (settings.value.purposeId === templateId) model.setPurpose("");
        },
        clearText() {
          model.update({ input: "", anonymized: [], output: "" });
        },
        setSize(width, height) {
          model.update(clampOnePurposeSize(width, height));
        },
        async loadModels() {
          if (!ctx.llm) throw new Error("LLM capability unavailable");
          const catalog = sortModels(await ctx.llm.models<LlmModelOption[]>());
          models.value = catalog;
          const selected = catalog.find((item) => item.id === settings.value.model);
          const next = selected?.configured
            ? selected.id
            : catalog.find((item) => item.configured)?.id ?? catalog[0]?.id ?? "";
          if (next && next !== settings.value.model) model.update({ model: next });
        },
        stream(request, onEvent) {
          if (!ctx.llm) return Promise.reject(new Error("LLM capability unavailable"));
          return ctx.llm.stream(request, onEvent);
        },
        cancel(requestId) {
          if (!ctx.llm) return Promise.reject(new Error("LLM capability unavailable"));
          return ctx.llm.cancel(requestId);
        },
      };

      liveModels.set(ctx.instanceId, model);
      onePurposeLlmModelRevision.value += 1;
      let hydrated = false;
      let persistence = Promise.resolve();
      const persist = () => {
        if (!hydrated) return;
        const snapshot = normalizeOnePurposeSettings(settings.value);
        persistence = persistence.catch(() => undefined).then(() =>
          ctx.data.set(ONE_PURPOSE_STATE_KEY, snapshot),
        );
      };

      watch(settings, persist, { deep: true });
      settings.value = normalizeOnePurposeSettings(
        await ctx.data.get<OnePurposeLlmSettings>(ONE_PURPOSE_STATE_KEY),
      );
      await hydrateSharedData(ctx);
      hydrated = true;
      void model.loadModels().catch(() => undefined);

      onScopeDispose(() => {
        persist();
        liveModels.delete(ctx.instanceId);
        onePurposeLlmModelRevision.value += 1;
        pendingInputFocus.delete(ctx.instanceId);
      });

      return model;
    },
  },
});

/** Kept next to the definition so the action can reuse the same validation. */
export function createOnePurposeTemplate(
  title: string,
  description: string,
  systemPrompt: string,
): CustomPurposeTemplate | null {
  return createCustomPurposeTemplate(
    { title, description, systemPrompt },
    `custom-${crypto.randomUUID()}`,
  );
}
