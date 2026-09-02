import type { WidgetRequest } from "@sdk/contract/sdk";

/**
 * Keeping credentials out of the debug panel.
 *
 * A debug panel is read on screen and photographed into bug reports. The first
 * widget to use it put an API token in a query argument, and the log printed it
 * in full; the screenshot that reported the bug carried a live key, and the key
 * had to be rotated.
 *
 * Its own module because there are now two ways in. Arguments arrive as
 * structured data and are redacted by **key name**. Faults arrive as free text
 * — `TypeError: Failed to fetch https://api.example.com/v2/?token=abc` — where
 * there is no key to read, only a string that happens to contain a URL. Two
 * call sites, one word list: a second list would be the one nobody updates.
 *
 * WHAT THIS IS NOT. It is display hygiene, not a security boundary. A widget
 * that wants its own token on screen can print it in a shape no rule matches,
 * and it is the widget's token anyway. The threat here is the ordinary one —
 * a person debugging, screenshotting, and pasting into an issue.
 */

/**
 * Redacted by **key name** rather than by value, because a token is not
 * recognisable as one — it is a string.
 *
 * Matched on word boundaries, not as substrings. The first version matched
 * substrings and redacted `keyword`, because `key` is inside it — hiding the
 * search term somebody was trying to debug. A rule that over-redacts is not the
 * safe direction: it makes the panel useless, which means people stop reading
 * it, which is how the real secret gets pasted somewhere else instead.
 */
const SECRET_WORDS = new Set([
  "token", "key", "apikey", "secret", "password", "passwd", "pwd", "auth", "credential", "credentials",
]);

/**
 * `X-Api-Key` -> ["x","api","key"]; `keyword` -> ["keyword"].
 *
 * Splitting on non-alphanumerics and camelCase covers `apiToken`,
 * `access_token`, `X-Api-Key` and `client-secret`, and leaves `keyword`,
 * `monkey` and `authority` alone.
 */
const wordsOf = (name: string): string[] =>
  name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^a-zA-Z0-9]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.toLowerCase());

/** Whether a parameter, header or field name reads as naming a credential. */
export const isSecretName = (name: string): boolean =>
  wordsOf(name).some((word) => SECRET_WORDS.has(word));

/**
 * Arguments, for reproducing a call — with anything secret-looking removed.
 *
 * `data.set` values are omitted whole: a widget's stored state can be large,
 * and it is the one thing here that is the person's content rather than a
 * description of a call.
 */
export function redactArgs(req: WidgetRequest): unknown {
  const raw = "args" in req ? req.args : req.type === "http.get" ? req.params : undefined;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return raw;

  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    // The key is still shown — that it was sent at all is often the answer —
    // and only the value is replaced.
    out[name] = isSecretName(name) && typeof value === "string" && value.length > 0 ? "***" : value;
  }
  return out;
}

/**
 * A query parameter and its value, anywhere in a string.
 *
 * Deliberately not parsed as a URL. The text this runs over is an error
 * message that *contains* a URL somewhere in the middle of a sentence, so
 * there is nothing to hand to `new URL()`; and a parse that fails would fall
 * back to printing the whole message, which is the outcome being prevented.
 */
const QUERY_PARAM = /([?&])([A-Za-z0-9_.\-[\]]+)=([^&\s"'<>)\]]+)/g;

/**
 * `Authorization: Bearer …` and friends, as they appear in a thrown message.
 *
 * The scheme is kept — knowing a request went out as Bearer rather than Basic
 * is half of diagnosing a 401 — and only the credential after it is replaced.
 */
const AUTH_SCHEME = /\b(Bearer|Basic|Token)\s+([A-Za-z0-9._~+/=-]{8,})/gi;

/**
 * Free text with credential-shaped parts replaced.
 *
 * Runs over anything a widget's own code produced: thrown messages, stack
 * frames, `console.error` output. Only the value is replaced, never the name
 * — `token=***` says a token was sent, which is usually the fact that solves
 * the problem, while `***` alone says nothing.
 *
 * The 8-character floor on `AUTH_SCHEME` is there so that prose survives:
 * "Bearer token missing" keeps its second word, and no real credential is
 * that short.
 */
export function redactText(text: string): string {
  return text
    .replace(QUERY_PARAM, (whole: string, lead: string, name: string) =>
      isSecretName(name) ? `${lead}${name}=***` : whole,
    )
    .replace(AUTH_SCHEME, (_whole, scheme: string) => `${scheme} ***`);
}
