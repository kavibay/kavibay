import { SANDBOX_THEME_TOKENS, applyTheme, readTheme } from "./sandboxTheme";
import { readThemeMessage, themeMessage } from "./sandboxTransport";

/**
 * Asserts for the theme hand-off.
 * Run: npx tsx core/app/extension-host/sandbox-theme.assert.ts
 *
 * Reading and applying both take their side of the DOM as a function, so the
 * decisions are testable here and only the two one-line call sites need a
 * document — the same split the data store uses for its backend.
 */

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

/** Stands in for getComputedStyle on the cockpit's documentElement. */
const cockpit: Record<string, string> = {
  "--fg-rgb": "255, 255, 255",
  "--inset-rgb": "0, 0, 0",
  "--surface-bg-rgb": "28, 28, 32",
  "--font-family": "Inter, system-ui, sans-serif",
  "--text": "rgba(255, 255, 255, 0.92)",
  "--text-muted": "rgba(255, 255, 255, 0.55)",
  "--text-faint": "rgba(255, 255, 255, 0.4)",
  "--border": "rgba(255, 255, 255, 0.1)",
  "--border-strong": "rgba(255, 255, 255, 0.28)",
  "--fill": "rgba(255, 255, 255, 0.08)",
  "--fill-hover": "rgba(255, 255, 255, 0.14)",
  "--inset-bg": "rgba(0, 0, 0, 0.25)",
  "--surface-radius": "16px",
  "--native-color-scheme": "dark",
  // Not on the list. A widget must not come to depend on the cockpit's
  // internals just because they happen to be defined.
  "--kavibay-private-thing": "leaked",
};

const read = (from: Record<string, string>) => readTheme((token) => from[token] ?? "");

// --- the whole documented set survives the round trip ---
{
  const theme = read(cockpit);
  const applied: Record<string, string> = {};
  const count = applyTheme((token, value) => { applied[token] = value; }, readThemeMessage(themeMessage(theme)));

  assert(count === SANDBOX_THEME_TOKENS.length, `every token arrives, got ${count} of ${SANDBOX_THEME_TOKENS.length}`);
  for (const token of SANDBOX_THEME_TOKENS) {
    assert(applied[token] === cockpit[token], `${token} survives, got ${applied[token]}`);
  }
  // The list is the contract, so what is not on it does not travel.
  assert(!("--kavibay-private-thing" in applied), "an undocumented token is not carried across");
}

// --- an undefined token is left out rather than sent empty ---
{
  const sparse = { ...cockpit };
  delete sparse["--font-family"];
  const theme = read(sparse);

  // Sending it empty would set an empty custom property in the guest, which
  // shadows the guest's own fallback with nothing — the font would go to the
  // browser default rather than staying on the fallback stack.
  assert(!("--font-family" in theme), "a token this document does not define is omitted");

  const applied: Record<string, string> = {};
  applyTheme((token, value) => { applied[token] = value; }, theme);
  assert(!("--font-family" in applied), "and nothing is written for it on the far side");
}

// --- values arrive trimmed ---
{
  // getPropertyValue returns a leading space for most declarations, and
  // `color-scheme: " dark"` is not a valid value.
  const theme = read({ "--native-color-scheme": "  dark  " });
  assert(theme["--native-color-scheme"] === "dark", `trimmed, got ${JSON.stringify(theme["--native-color-scheme"])}`);
}

// --- garbage is not applied ---
{
  for (const junk of [null, undefined, "a string", 42, []]) {
    const applied: Record<string, string> = {};
    const count = applyTheme((token, value) => { applied[token] = value; }, junk);
    assert(count === 0, `nothing is applied from ${JSON.stringify(junk)}`);
  }

  const applied: Record<string, string> = {};
  applyTheme(
    (token, value) => { applied[token] = value; },
    { "--fg-rgb": { nested: true }, "--text": 5, "--border": "", "--fill": "rgba(0,0,0,0.1)" },
  );
  assert(Object.keys(applied).join(",") === "--fill", `only usable strings are applied, got ${JSON.stringify(applied)}`);
}

// --- a theme message is not mistaken for anything else ---
{
  assert(readThemeMessage({ kind: "kavibay.widget.init", payload: "{}" }) === undefined, "init is not a theme");
  assert(readThemeMessage({ kind: "kavibay.widget.theme" }) === undefined, "a theme without a payload is not one");
  assert(readThemeMessage({ kind: "kavibay.widget.theme", payload: "{oops" }) === undefined, "unparseable is not one");
  assert(readThemeMessage({ kind: "kavibay.widget.theme", payload: '"a string"' }) === undefined, "a non-object payload is not one");
  assert(readThemeMessage({ kind: "kavibay.widget.theme", payload: '{"--text":"red"}' })?.["--text"] === "red", "a real one reads back");
}

console.log("sandbox-theme.assert.ts: ok");
