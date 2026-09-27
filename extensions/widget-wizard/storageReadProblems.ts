// SPDX-License-Identifier: MIT
import { tokenize } from "./highlight";

/** Catch the common generated `const saved = ctx.data.get(...); saved.field` bug.
 * This is deliberately conservative, not a JavaScript validator. The guest
 * also guards storage promises at runtime, including aliases this cannot see.
 */
export function storageReadProblems(files: { path: string; contents: string }[]): string[] {
  const problems: string[] = [];
  for (const file of files) {
    if (!/\.js$/i.test(file.path)) continue;
    const code = tokenize(file.contents, "script")
      .map(token => token.kind === "string" || token.kind === "comment" ? " ".repeat(token.text.length) : token.text)
      .join("");
    const reads = /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*((?:[A-Za-z_$][\w$]*\s*\.\s*data|kavibay\s*\.\s*storage)\s*\.\s*get)\s*\([^()]*\)\s*;/g;
    for (const read of code.matchAll(reads)) {
      const name = read[1]!;
      const escaped = name.replace(/\$/g, "\\$");
      // A reused name needs scope analysis. Leave that case to the runtime.
      if ([...code.matchAll(new RegExp(`\\b(?:const|let|var)\\s+${escaped}\\b`, "g"))].length !== 1) continue;
      // Do not follow a binding into another function (which may shadow it).
      const after = code.slice(read.index! + read[0].length).split(/\bfunction\b|=>|\bclass\b/)[0]!;
      // Require a dot: an awaited variable, or a Promise passed to another
      // function, is valid and must not be mistaken for a field access.
      const property = new RegExp(`(?<![\\w$])${escaped}\\s*(?:\\?\\.|\\.)\\s*([A-Za-z_$][\\w$]*)`, "g");
      const badField = [...after.matchAll(property)].find(match =>
        !["then", "catch", "finally", "constructor", "toString", "valueOf"].includes(match[1]!));
      if (!badField) continue;
      problems.push(`${file.path}: ${name} is a Promise from ${read[2]!.replace(/\s/g, "")}(...), but ${name}.${badField[1]} reads it as saved data. Add await to the storage read before choosing defaults or writing state.`);
    }
  }
  return problems;
}
