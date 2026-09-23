import { effectScope } from "vue";
import type { WidgetContext } from "@sdk/contract/sdk";
import { clipboardWidget, type ClipboardModel } from "./clipboard";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const entry = (text: string) => ({ id: text, kind: "text", text, hash: text, createdAt: 1 });
const texts = (model: ClipboardModel) => model.entries.value.map((e) => e.text).join();

/** The history as the host sees it: `list()` answers late, pushes arrive when they arrive. */
let answerList: (entries: unknown) => void = () => {};
let listCalls = 0;
let push: (entries: unknown) => void = () => {};
let unsubscribed = false;

const context = {
  instanceId: "clipboard-assert",
  config: {},
  clipboard: {
    writeText: async () => {},
    list: <T>() => {
      listCalls += 1;
      return new Promise<T>((resolve) => { answerList = resolve as (entries: unknown) => void; });
    },
    onChange: async <T>(listener: (entries: T) => void) => {
      push = listener as (entries: unknown) => void;
      return () => { unsubscribed = true; };
    },
    restore: async () => {},
    setRevealed: async () => {},
    delete: async () => {},
    clear: async () => {},
    imageUrl: () => "",
  },
  launcher: { extractIcon: async () => "" },
} as unknown as WidgetContext;

const scope = effectScope();
const model = scope.run(() => clipboardWidget.component.setup(context)) as ClipboardModel;
await Promise.resolve();

// A copy lands while the first read is still out: the push is newer and must win.
push([entry("new"), entry("old")]);
answerList([entry("old")]);
await model.refresh();
assert(texts(model) === "new,old", `a late list() must not overwrite a newer push: ${texts(model)}`);

// Later changes arrive by push alone — no read goes out for them.
const readsSoFar = listCalls;
push([entry("newer"), entry("new"), entry("old")]);
assert(texts(model) === "newer,new,old", `a push updates the history: ${texts(model)}`);
await new Promise((resolve) => setTimeout(resolve, 1_100));
assert(listCalls === readsSoFar, `nothing polls in the background: ${listCalls - readsSoFar} extra reads`);

scope.stop();
await Promise.resolve();
assert(unsubscribed, "unmounting stops listening");

console.log("clipboard.assert.ts: ok");
