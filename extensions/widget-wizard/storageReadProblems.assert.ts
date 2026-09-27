// SPDX-License-Identifier: MIT
import { storageReadProblems } from "./storageReadProblems";

function equal(actual: number, expected: number) {
  if (actual !== expected) throw new Error(`Expected ${expected} problems, got ${actual}`);
}

const check = (contents: string) => storageReadProblems([{ path: "widget.js", contents }]);
for (const read of ['ctx.data.get("water-tracker")', 'kavibay.storage.get()']) {
  equal(check(`const saved = ${read}; const glasses = saved?.date === today ? saved.glasses : 0;`).length, 1);
  equal(check(`const saved = await ${read}; const glasses = saved?.glasses ?? 0;`).length, 0);
  equal(check(`const pending = ${read}; const saved = await pending; saved.glasses;`).length, 0);
  equal(check(`const pending = ${read}; pending.then(saved => saved.glasses);`).length, 0);
  equal(check(`const pending = ${read}; const [saved] = await Promise.all([pending]); saved.glasses;`).length, 0);
  equal(check(`// const saved = ${read}; saved.glasses;`).length, 0);
  equal(check(`const help = 'const saved = ${read}; saved.glasses;';`).length, 0);
}
equal(check('const saved = ctx.data.get("x"); function display(saved) { return saved.glasses; }').length, 0);
console.log("storageReadProblems.assert: ok");
