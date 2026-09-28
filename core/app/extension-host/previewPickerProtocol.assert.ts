import { readPreviewPick } from "./previewPickerProtocol";

function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
}
const frame = {};
const element = { selector: "#progress", tag: "div", text: "250 ml" };
const selected = { type: "kavibay.preview.selected", token: "current", element };
const read = (data: unknown, token: string | null = "current", source: unknown = frame) => readPreviewPick({ source, data }, frame, token);

equal(read(selected), { type: "selected", element });
equal(read(selected, null), null); // Disabled, completed or cancelled picker.
equal(read(selected, "new-run"), null); // Delayed reply from the previous selection.
equal(read(selected, "current", {}), null); // Another widget cannot name this frame.
equal(readPreviewPick({ source: null, data: selected }, null, "current"), null);
equal(read({ type: "kavibay.preview.cancelled", token: "current" }), { type: "cancelled" });
equal(read({ type: "kavibay.preview.cancelled", token: "stale" }), null);
for (const data of [null, 3, "text", {}, { ...selected, type: "kavibay.ext.http.call" }, { ...selected, token: undefined }]) equal(read(data), null);
for (const bad of [null, {}, { ...element, tag: "<script>" }, { ...element, tag: "a".repeat(33) },
  { ...element, selector: " " }, { ...element, selector: "a".repeat(513) },
  { ...element, text: "a".repeat(201) }, { ...element, text: 42 }]) {
  equal(read({ ...selected, element: bad }), null);
}
equal(read({ ...selected, element: { ...element, value: "private", html: "<input>" } }), { type: "selected", element });
console.log("previewPickerProtocol.assert: ok");
