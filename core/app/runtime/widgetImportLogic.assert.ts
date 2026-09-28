import { describeImportError, fileNameOf, firstZip } from "./widgetImportLogic";

function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual !== expected) throw new Error(`${msg}: expected ${String(expected)}, got ${String(actual)}`);
}

assertEqual(
  firstZip(["/Users/a/notes.txt", "/Users/a/Counter.ZIP", "/Users/a/b.zip"]),
  "/Users/a/Counter.ZIP",
  "the first archive wins, whatever its case",
);
assertEqual(firstZip(["/Users/a/picture.png", "/Users/a/zip"]), undefined, "no archive, no import");

assertEqual(fileNameOf("/Users/a/counter.zip"), "counter.zip", "posix path");
assertEqual(fileNameOf("C:\\Users\\a\\counter.zip"), "counter.zip", "windows path");

assertEqual(
  describeImportError("id_taken:counter"),
  'A widget named "counter" already exists. Delete it first, or change the id in this widget\'s manifest.',
  "a taken id names the widget",
);
assertEqual(
  describeImportError("file_too_large:ui/app.js"),
  "ui/app.js is larger than the 512 KB a widget file may be.",
  "an oversized file is named",
);
assertEqual(
  describeImportError("Error: enable_refused"),
  "The widget was installed but could not be turned on. Enable it in Settings → Extensions.",
  "a thrown Error's prefix is ignored",
);
assertEqual(
  describeImportError("missing_ui_entry_file"),
  "The widget did not pass validation (missing_ui_entry_file).",
  "a scan error is shown as the validator named it",
);

console.log("widgetImportLogic.assert: ok");
