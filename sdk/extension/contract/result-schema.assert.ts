// SPDX-License-Identifier: MIT
/**
 * Run: npx tsx core/app/extension-host/result-schema.assert.ts
 */
import type { ResultSchema } from "./sdk";
import { resultSchemaProblems } from "./resultSchema";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const room: ResultSchema = {
  type: "list",
  of: {
    type: "object",
    fields: {
      id: { type: "string" },
      name: { type: "string" },
      temperature: { type: "number", nullable: true },
    },
  },
};

assert(
  resultSchemaProblems(room, [{ id: "1", name: "Bad", temperature: 21.5 }]).length === 0,
  "a response matching its declaration reports nothing",
);

assert(
  resultSchemaProblems(room, [{ id: "1", name: "Bad", temperature: null }]).length === 0,
  "an offline room has no temperature, and nullable says so",
);

assert(
  resultSchemaProblems(room, [{ id: "1", temperature: 21.5 }]).length === 1,
  "a non-nullable field the schema promises and the response lacks is a problem",
);

assert(
  resultSchemaProblems(room, [{ id: "1", name: "Bad" }]).length === 0,
  "a nullable field may be absent as well as null — an offline room sends neither",
);

assert(
  resultSchemaProblems(room, [{ id: 1, name: "Bad", temperature: 21.5 }])[0].includes("[0].id"),
  "the path names the element and the field, so the fix is one line",
);

// The case that reaches a user rather than a reviewer.
assert(
  resultSchemaProblems(room, [
    { id: "1", name: "Bad", temperature: 21 },
    { id: "2", name: "Kueche", temperature: "warm" },
  ])[0].includes("[1].temperature"),
  "every element is checked, not only the first",
);

assert(
  resultSchemaProblems(room, [{ id: "1", name: "Bad", temperature: 21, extra: "upstream" }])
    .length === 0,
  "an extra field upstream added is noise no widget reads, not a failure",
);

assert(
  resultSchemaProblems(room, { rooms: [] })[0].includes("declared a list"),
  "an object where a list was declared is caught",
);

assert(
  resultSchemaProblems({ type: "string" }, null)[0].includes("declared string"),
  "null is refused unless the schema allows it",
);

console.log("result-schema.assert.ts: ok");
