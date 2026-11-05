import type { ExtensionManifest } from "@sdk/contract/sdk";
import { HostMessages, isHostKey, localizeActions, localizeDefinition } from "./localizeExtension";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const setup = () => ({});
const definition: ExtensionManifest = {
  name: "clock",
  version: "1.0.0",
  displayName: "Clock",
  description: "Local time.",
  engines: { kavibay: "^0.1" },
  contributes: {
    widgets: [
      {
        name: "clock",
        displayName: "Clock",
        defaultSize: { w: 2, h: 2 },
        configuration: {
          dateStyle: {
            type: "select",
            label: "Date style",
            options: [
              { value: "long", label: "Long" },
              { value: "none", label: "No date" },
            ],
          },
          hour12: { type: "boolean", label: "12-hour clock" },
        },
        component: { setup },
      },
    ],
  },
};

const messages = new HostMessages({
  "extension.displayName": "Uhr",
  "widgets.clock.displayName": "Uhr",
  "widgets.clock.config.dateStyle.label": "Datumsformat",
  "widgets.clock.config.dateStyle.options.none": "Kein Datum",
  "widgets.clock.actions.reset.title": "Zurücksetzen",
  "actions.open.subtitle": "Öffnet die Uhr",
  "widgets.clock.config.renamed.label": "Weg",
  greeting: "Hallo",
});

const localized = localizeDefinition(definition, messages);
const widget = localized.contributes.widgets![0]!;

assert(localized.displayName === "Uhr", "the extension name is translated");
assert(localized.description === "Local time.", "an untranslated description keeps its English");
assert(widget.displayName === "Uhr", "the widget name is translated");
assert(widget.description === undefined && !("description" in widget), "an absent description stays absent");
assert(widget.configuration!.dateStyle!.label === "Datumsformat", "a field label is translated");
assert(widget.configuration!.dateStyle!.options![1]!.label === "Kein Datum", "an option label is translated");
assert(widget.configuration!.dateStyle!.options![0]!.label === "Long", "an untranslated option keeps its English");
assert(widget.configuration!.hour12!.label === "12-hour clock", "an untranslated field keeps its English");
assert(widget.component.setup === setup, "behavior is the same object, only text is copied");
assert(definition.displayName === "Clock", "the source definition is not mutated");
assert(definition.contributes.widgets![0]!.configuration!.dateStyle!.label === "Date style", "nor its fields");

const [reset] = localizeActions([{ id: "reset", title: "Reset" }], "widgets.clock.actions.", messages);
assert(reset!.title === "Zurücksetzen", "a widget action title is translated");
assert(!("subtitle" in reset!), "an absent subtitle stays absent");
const [open] = localizeActions(
  [{ id: "open", title: "Open clock", subtitle: "Shows the clock", params: [{ name: "zone", type: "text", required: false, placeholder: "Zone" }] }],
  "actions.",
  messages,
);
assert(open!.title === "Open clock" && open!.subtitle === "Öffnet die Uhr", "a standalone action is translated per field");
assert(open!.params![0]!.placeholder === "Zone", "an untranslated placeholder keeps its English");

assert(
  messages.unused().join() === "widgets.clock.config.renamed.label",
  "a host key that names nothing is reported, a widget key is not",
);
assert(isHostKey("widgets.x") && isHostKey("actions.x") && isHostKey("extension.x"), "host prefixes");
assert(!isHostKey("lap") && !isHostKey("widgetsTitle"), "widget keys are everything else");

console.log("localizeExtension.assert.ts: ok");
