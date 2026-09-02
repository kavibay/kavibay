import { createCommandUi } from "./commandUi";

/**
 * Asserts for the Phase 5 command UI.
 * Run: npx tsx core/app/extension-host/command-ui.assert.ts
 *
 * `runCommand` awaits `ui.prompt` and `ui.confirm` as if they were ordinary
 * async calls; the dialog turns them into something a user answers. That
 * translation is the part with states, and it had never been executed —
 * no command in the cockpit reaches it yet, because the only provider that
 * ships is read-only.
 */

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const spec = { name: "calendarId", type: "string", label: "Calendar", required: true } as const;

// --- a prompt resolves with what the user answered ---
{
  const ui = createCommandUi();
  assert(ui.request.value === null, "nothing is asked before a command asks");

  const answer = ui.ui.prompt({ ...spec });
  assert(ui.request.value?.kind === "prompt", "the dialog is told to render a prompt");

  ui.answer("primary");
  assert((await answer) === "primary", "the command receives the answer");
  assert(ui.request.value === null, "and the dialog closes");
}

// --- cancelling resolves undefined, which runCommand reads as "do nothing" ---
{
  const ui = createCommandUi();
  const answer = ui.ui.prompt({ ...spec });
  ui.answer(undefined);
  assert((await answer) === undefined, "a cancelled prompt resolves undefined, never rejects");
}

// --- confirm is a boolean, and a closed dialog means no ---
{
  const ui = createCommandUi();
  const yes = ui.ui.confirm("Delete event?");
  assert(ui.request.value?.kind === "confirm", "the dialog renders a confirmation");
  ui.confirm(true);
  assert((await yes) === true, "confirmed");

  const no = ui.ui.confirm("Delete event?");
  ui.confirm(false);
  assert((await no) === false, "refused");
}

/**
 * The invariant that matters most here: every promise settles. A command
 * awaiting a prompt that never resolves is a command that never finishes, and
 * nothing in the UI would show that it is still waiting.
 */
{
  const ui = createCommandUi();
  const first = ui.ui.prompt({ ...spec, name: "one" });
  const second = ui.ui.prompt({ ...spec, name: "two" });

  assert((await first) === undefined, "a superseded prompt resolves rather than hanging");
  assert(ui.request.value?.kind === "prompt", "the newer one is what the dialog shows");

  ui.answer("answered");
  assert((await second) === "answered", "and it is the one that receives the answer");
}

// --- a confirm displacing a prompt settles it too, and the other way round ---
{
  const ui = createCommandUi();
  const prompt = ui.ui.prompt({ ...spec });
  const confirm = ui.ui.confirm("sure?");
  assert((await prompt) === undefined, "the displaced prompt settles");

  const laterPrompt = ui.ui.prompt({ ...spec });
  assert((await confirm) === false, "a displaced confirm settles as a refusal, never an approval");
  ui.answer("x");
  assert((await laterPrompt) === "x", "the surviving request still answers");
}

// --- notify says something without asking anything ---
{
  const ui = createCommandUi();
  assert(ui.notice.value === null, "nothing to show at rest");
  ui.ui.notify("Living room to 21 degrees failed");
  assert(ui.notice.value === "Living room to 21 degrees failed", "the message is available");
  assert(ui.request.value === null, "and notify never opens a dialog — it must not block");
  ui.dismissNotice();
  assert(ui.notice.value === null, "dismissed");
}

console.log("command-ui.assert.ts: ok");
