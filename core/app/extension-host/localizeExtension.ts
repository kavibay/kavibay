/**
 * Translated catalog text for a bundled extension: the strings the HOST renders
 * on an extension's behalf.
 *
 * An extension's `i18n/<lang>.ts` holds two kinds of keys:
 *
 *   widget keys   anything else — looked up by the widget itself through
 *                 `createTranslator(…, ctx.locale)` for text it draws
 *   host keys     `extension.*`, `widgets.*`, `actions.*` — read here, for the
 *                 names, descriptions, settings labels and palette actions the
 *                 host draws in Settings, the palette and the widget chrome
 *
 * English stays where it is today, in `manifest.json` and the widget
 * definition; host keys appear only in translations and lay themselves over
 * that source. So `en.ts` never repeats a widget's name, and an extension
 * without an `i18n/` folder is unaffected.
 *
 * Host keys, by what they translate:
 *
 *   extension.displayName / extension.description
 *   widgets.<widget>.displayName / .description
 *   widgets.<widget>.config.<field>.label
 *   widgets.<widget>.config.<field>.options.<value>
 *   widgets.<widget>.actions.<action>.title / .subtitle
 *   widgets.<widget>.actions.<action>.params.<param>.placeholder
 *   actions.<action>.title / .subtitle / .params.<param>.placeholder
 *
 * Applied once, when the bundled catalog loads — the host locale is fixed for
 * the life of the app, so there is no second pass to keep in step. Every
 * function returns copies: the definition modules stay the English source.
 */
import type {
  ConfigField,
  ExtensionManifest,
  WidgetActionParam,
  WidgetDefinition,
} from "@sdk/contract/sdk";

export const HOST_KEY_PREFIXES = ["extension.", "widgets.", "actions."] as const;

export function isHostKey(key: string): boolean {
  return HOST_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/**
 * Host-key lookup over one translation, remembering what was asked for so a
 * guard can report keys that match nothing — a renamed widget or field would
 * otherwise leave its translation silently unused.
 */
export class HostMessages {
  readonly used = new Set<string>();

  constructor(private readonly messages: Readonly<Record<string, unknown>> = {}) {}

  /** The translation for `key`, or `fallback` when there is none. */
  text<T extends string | undefined>(key: string, fallback: T): T | string {
    this.used.add(key);
    const value = this.messages[key];
    return typeof value === "string" && value.trim() ? value : fallback;
  }

  /** Host keys the translation holds that nothing asked for. */
  unused(): string[] {
    return Object.keys(this.messages).filter((key) => isHostKey(key) && !this.used.has(key));
  }
}

/** Only sets an optional field the source has, so `undefined` stays absent. */
function withOptional<T extends object, K extends keyof T>(
  target: T,
  field: K,
  value: T[K] | string | undefined,
): T {
  return value === undefined ? target : { ...target, [field]: value };
}

function localizeParams<P extends WidgetActionParam>(
  params: P[] | undefined,
  prefix: string,
  m: HostMessages,
): P[] | undefined {
  return params?.map((param) =>
    withOptional(param, "placeholder", m.text(`${prefix}.params.${param.name}.placeholder`, param.placeholder)),
  );
}

/** Palette actions, standalone (`actions.`) or a widget's (`widgets.<w>.actions.`). */
export function localizeActions<
  A extends { id: string; title: string; subtitle?: string; params?: WidgetActionParam[] },
>(actions: A[], prefix: string, m: HostMessages): A[] {
  return actions.map((action) => {
    const base = `${prefix}${action.id}`;
    const localized: A = { ...action, title: m.text(`${base}.title`, action.title) };
    const withSubtitle = withOptional(localized, "subtitle", m.text(`${base}.subtitle`, action.subtitle));
    return withOptional(withSubtitle, "params", localizeParams(action.params, base, m));
  });
}

function localizeField(field: ConfigField, base: string, m: HostMessages): ConfigField {
  return {
    ...field,
    label: m.text(`${base}.label`, field.label),
    ...(field.options
      ? {
          options: field.options.map((option) => ({
            ...option,
            label: m.text(`${base}.options.${option.value}`, option.label),
          })),
        }
      : {}),
  };
}

function localizeWidget(widget: WidgetDefinition<any>, m: HostMessages): WidgetDefinition<any> {
  const base = `widgets.${widget.name}`;
  const localized: WidgetDefinition<any> = {
    ...widget,
    displayName: m.text(`${base}.displayName`, widget.displayName),
  };
  const described = withOptional(localized, "description", m.text(`${base}.description`, widget.description));
  if (!widget.configuration) return described;
  return {
    ...described,
    configuration: Object.fromEntries(
      Object.entries(widget.configuration).map(([key, field]) => [
        key,
        localizeField(field, `${base}.config.${key}`, m),
      ]),
    ),
  };
}

/** The definition with its names, descriptions and settings labels translated. */
export function localizeDefinition(definition: ExtensionManifest, m: HostMessages): ExtensionManifest {
  const localized: ExtensionManifest = {
    ...definition,
    displayName: m.text("extension.displayName", definition.displayName),
  };
  const described = withOptional(localized, "description", m.text("extension.description", definition.description));
  return {
    ...described,
    contributes: {
      ...definition.contributes,
      ...(definition.contributes.widgets
        ? { widgets: definition.contributes.widgets.map((widget) => localizeWidget(widget, m)) }
        : {}),
    },
  };
}
