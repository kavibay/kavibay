/**
 * Run: npx tsx extensions/snippets/snippetsLogic.assert.ts
 */
import {
  createSnippet,
  extractPlaceholders,
  fillSnippetTemplate,
  normalizeSnippets,
  resolveSnippetTemplate,
  snippetActionParams,
  type Snippet,
} from "./snippetsLogic";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function eq(actual: unknown, expected: unknown, msg: string): void {
  if (actual !== expected) {
    throw new Error(`${msg}\n  expected: ${String(expected)}\n  actual:   ${String(actual)}`);
  }
}

function deepEq(actual: unknown, expected: unknown, msg?: string): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) {
    throw new Error(`${msg ?? "deep equal"}\n  expected: ${b}\n  actual:   ${a}`);
  }
}

function snippet(name: string, template: string, id = name.toLowerCase()): Snippet {
  return { id, name, template };
}

deepEq(extractPlaceholders("hallo {name} wie geht's?"), ["name"]);
deepEq(
  extractPlaceholders("Hi {name}, your {code} is {code}."),
  ["name", "code"],
  "first appearance order, duplicates collapsed",
);
deepEq(extractPlaceholders("no placeholders"), []);
deepEq(extractPlaceholders("{a} {b} {a}"), ["a", "b"]);
deepEq(extractPlaceholders("{not valid} {_ok} {1bad} {ok2}"), ["_ok", "ok2"]);
deepEq(extractPlaceholders("{{}} { } {}"), []);

eq(
  fillSnippetTemplate("hallo {name} wie geht's?", { name: "Alex" }),
  "hallo Alex wie geht's?",
  "fills a named placeholder",
);
eq(
  fillSnippetTemplate("{a} and {b} and {a}", { a: "1", b: "2" }),
  "1 and 2 and 1",
  "repeats the same placeholder",
);
eq(
  fillSnippetTemplate("leave {missing}", {}),
  "leave {missing}",
  "unknown placeholders stay as written",
);
eq(fillSnippetTemplate("plain", {}), "plain", "no tokens");

const library = [
  snippet("Greeting", "Hallo {name}, wie geht's?"),
  snippet("Sign-off", "Best,\n{name}"),
];

eq(
  resolveSnippetTemplate(library, "Greeting"),
  "Hallo {name}, wie geht's?",
  "saved name wins",
);
eq(
  resolveSnippetTemplate(library, "greeting"),
  "Hallo {name}, wie geht's?",
  "name match is case-insensitive",
);
eq(
  resolveSnippetTemplate(library, "  Sign-off  "),
  "Best,\n{name}",
  "name is trimmed",
);
eq(
  resolveSnippetTemplate(library, "hallo {name} wie geht's?"),
  "hallo {name} wie geht's?",
  "unknown input is treated as a raw template",
);
eq(resolveSnippetTemplate(library, ""), "", "empty input");

{
  const params = snippetActionParams([], []);
  eq(params.length, 1, "one chip without a library");
  eq(params[0]?.name, "template", "first chip is the template");
  eq(params[0]?.type, "text", "ad-hoc template is free text");
  eq(params[0]?.required, true, "template is required");
}

{
  const params = snippetActionParams([], ["hallo {name} wie geht's?"]);
  deepEq(
    params.map((param) => param.name),
    ["template", "name"],
  );
  eq(params[1]?.placeholder, "{name}", "chip label is the token");
  eq(params[1]?.required, true, "placeholders are required");
  eq(params[1]?.type, "text", "placeholder chips are text");
}

{
  const params = snippetActionParams(library, ["Greeting"]);
  eq(params[0]?.type, "text", "typed templates must still be allowed");
  deepEq(params[0]?.options, ["Greeting", "Sign-off"], "saved names are suggestions");
  deepEq(
    params.map((param) => param.name),
    ["template", "name"],
    "saved snippet body supplies the placeholder chips",
  );
}

{
  const params = snippetActionParams(library, ["Hi {first} {last}"]);
  deepEq(
    params.map((param) => param.name),
    ["template", "first", "last"],
    "a typed template still expands even when saved snippets exist",
  );
}

{
  const params = snippetActionParams([], ["keep {template} and {name}"]);
  deepEq(
    params.map((param) => param.name),
    ["template", "name"],
    "placeholder that collides with the template param is skipped",
  );
}

{
  const created = createSnippet({ name: "  Hi  ", template: "  {name}  " });
  assert(created.id.length > 0, "new snippets get an id");
  eq(created.name, "Hi", "name is trimmed");
  eq(created.template, "{name}", "template is trimmed");
}

{
  const normalized = normalizeSnippets({
    snippets: [
      { id: "a", name: "A", template: "one {x}" },
      { name: "dropped" },
      { id: "a", name: "dup", template: "ignored" },
      { id: "b", name: "  ", template: "empty name" },
      { id: "c", name: "C", template: "two" },
    ],
  });
  deepEq(normalized, [
    { id: "a", name: "A", template: "one {x}" },
    { id: "c", name: "C", template: "two" },
  ]);
  deepEq(normalizeSnippets(null), []);
  deepEq(normalizeSnippets({ snippets: "nope" }), []);
}

console.log("snippetsLogic.assert.ts: ok");
