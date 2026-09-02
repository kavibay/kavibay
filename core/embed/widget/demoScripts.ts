import { playWizardDemo } from "./wizardAutoplay";

/**
 * Widgets that can play themselves, keyed by definition name.
 *
 * A side table rather than a field on the catalog entry, and rather than a
 * branch inside `KavibayWidget.vue`. The element should know that *some*
 * widgets have a demo script; it should not know what the Widget Wizard is.
 * One `import` in this file is the whole coupling.
 *
 * A script receives the element's own subtree and a veto. It must check the
 * veto between steps and stop when it turns false — that is how a visitor
 * takes over from a demo mid-sentence.
 */
export type DemoScript = (root: ParentNode, alive: () => boolean) => Promise<void>;

const SCRIPTS: Record<string, DemoScript> = {
  "widget-wizard": playWizardDemo,
};

export function demoScript(definition: string): DemoScript | undefined {
  return SCRIPTS[definition];
}
