/**
 * Checks for the debug panel's redaction.
 * Run: npx tsx core/app/extension-host/redact.assert.ts
 *
 * Both directions are load-bearing and only one of them is obvious. Letting a
 * token through puts a live credential in a screenshot — that already happened
 * once, and the key had to be rotated. Redacting too much makes the panel
 * useless, so people stop reading it and go back to pasting whole responses
 * into a chat window, which is how the secret gets out anyway.
 */
import type { WidgetRequest } from "@sdk/contract/sdk";
import { isSecretName, redactArgs, redactText } from "./redact";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}
const assertEq = (actual: unknown, expected: unknown, msg: string) =>
  assert(
    Object.is(actual, expected),
    `${msg}\n  expected: ${String(expected)}\n  actual:   ${String(actual)}`,
  );

// --- names -------------------------------------------------------------------
for (const name of ["token", "apiToken", "access_token", "X-Api-Key", "client-secret", "PASSWORD"]) {
  assert(isSecretName(name), `${name} reads as a credential`);
}
// The over-redaction cases. `keyword` is the one that actually bit: a WAQI
// station search sends `keyword=Potsdam`, and hiding it hid the search term
// somebody was trying to debug.
for (const name of ["keyword", "monkey", "authority", "keys_pressed", "tokenizer"]) {
  assert(!isSecretName(name), `${name} is ordinary and stays visible`);
}

// --- arguments ---------------------------------------------------------------
{
  const req = {
    type: "endpoint.call",
    endpoint: "search",
    args: { keyword: "Potsdam", token: "live-secret-value", limit: 5 },
  } as unknown as WidgetRequest;
  const out = redactArgs(req) as Record<string, unknown>;
  assertEq(out.token, "***", "the token value is replaced");
  assertEq(out.keyword, "Potsdam", "the search term survives");
  assertEq(out.limit, 5, "non-strings are untouched");
  assert("token" in out, "the name stays — that it was sent at all is often the answer");
}
{
  const req = { type: "endpoint.call", endpoint: "x", args: { token: "" } } as unknown as WidgetRequest;
  const out = redactArgs(req) as Record<string, unknown>;
  assertEq(out.token, "", "an empty value is not dressed up as a hidden one");
}

// --- free text ---------------------------------------------------------------
// The realistic shape: a fetch that failed, with the whole URL in the message.
assertEq(
  redactText("TypeError: Failed to fetch https://api.waqi.info/v2/search/?token=abc123&keyword=Potsdam"),
  "TypeError: Failed to fetch https://api.waqi.info/v2/search/?token=***&keyword=Potsdam",
  "a token in a URL goes, the keyword beside it stays",
);
assertEq(
  redactText("GET /feed/@6189/?token=xyz"),
  "GET /feed/@6189/?token=***",
  "the first parameter is caught too",
);
assertEq(
  redactText("401 with header Authorization: Bearer eyJhbGciOiJIUzI1NiJ9"),
  "401 with header Authorization: Bearer ***",
  "a bearer credential goes and the scheme stays",
);
assertEq(
  redactText("Bearer token missing"),
  "Bearer token missing",
  "prose is not a credential — the 8-character floor is what keeps this readable",
);
assertEq(
  redactText("no credentials here, just ?limit=5&q=rain"),
  "no credentials here, just ?limit=5&q=rain",
  "an ordinary query string is left alone",
);
// Nothing is parsed as a URL, because there is no URL — only a sentence that
// happens to contain one. A parse that failed would fall back to printing the
// whole message, which is the outcome being prevented.
assertEq(
  redactText("giving up (tried ?apikey=zzz twice)"),
  "giving up (tried ?apikey=*** twice)",
  "a credential mid-sentence is found without parsing",
);

console.log("redact.assert.ts ok");
