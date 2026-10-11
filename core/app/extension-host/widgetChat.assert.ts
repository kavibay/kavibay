import {
  MAX_TOOL_ROUNDS, argSpecToSchema, buildTools, fitForModel, promptConfig, runQuestion, systemPrompt, toolName,
  type ChatMessage, type QueryInfo, type QuestionIo, type RoundResult,
} from "./widgetChat";

/**
 * Widget chat, the pure half.
 * Run: npx tsx core/app/extension-host/widgetChat.assert.ts
 */

function assert(cond: unknown, msg = "assertion failed") {
  if (!cond) throw new Error(msg);
}
function equal(actual: unknown, expected: unknown, msg = "") {
  if (actual !== expected) throw new Error(`${msg} expected ${String(expected)}, got ${String(actual)}`);
}
/** Deep equality by JSON; every object compared here is built in a fixed key order. */
function same(actual: unknown, expected: unknown, msg = "") {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg} expected ${e}, got ${a}`);
}

const FITBIT = "kavibay.fitbit/fitbit";
const TADO = "kavibay.tado/tado";
const queries: Record<string, Record<string, QueryInfo>> = {
  [FITBIT]: {
    sleepToday: { description: "Last night's sleep", args: { date: { type: "string", label: "Night (yyyy-MM-dd)" } } },
    sleepHeartRate: {
      description: "Heart rate during sleep",
      args: {
        start: { type: "string", label: "Start", required: true },
        end: { type: "string", label: "End", required: true },
      },
    },
  },
  [TADO]: {
    zones: { description: "Rooms" },
    roomHistory: {
      description: "Room climate",
      args: { zoneId: { type: "string", label: "Room", required: true, source: { query: "zones" } } },
    },
    windowOpen: { description: "Declared by the provider, not by the widget" },
  },
};
const lookup = (id: string) => queries[id];

// --- tool names fit the providers' alphabet (Review Focus: odd names) ---
equal(toolName(FITBIT, "sleepToday"), "fitbit_sleepToday");
equal(toolName("acme.x/tado°", "zone states"), "tado__zone_states");
assert(toolName(`a/${"x".repeat(80)}`, "q").length <= 64);

// --- one tool per declared query, schema from ArgSpec ---
{
  const { tools, routes } = buildTools(
    { [FITBIT]: ["sleepToday", "sleepHeartRate"], [TADO]: ["zones", "roomHistory"] },
    lookup,
  );
  same(tools.map((tool) => tool.name), [
    "fitbit_sleepToday", "fitbit_sleepHeartRate", "tado_zones", "tado_roomHistory",
  ]);
  same(routes.get("tado_roomHistory"), { provider: TADO, query: "roomHistory" });
  same(tools[1]!.inputSchema.required, ["start", "end"]);
  equal(tools[1]!.inputSchema.additionalProperties, false);
  equal(tools[3]!.inputSchema.properties.zoneId!.description, "Room (a value from tado_zones)");
  equal(tools[0]!.description, "Last night's sleep");
  assert(!routes.has("tado_windowOpen"), "only declared queries become tools");
}

// --- unknown queries are skipped; colliding names get a suffix ---
{
  const { tools } = buildTools(
    { [FITBIT]: ["sleepToday", "missing"], "other.vendor/fitbit": ["sleepToday"] },
    (id) => (id === FITBIT ? queries[FITBIT] : { sleepToday: { description: "Other" } }),
  );
  same(tools.map((tool) => tool.name), ["fitbit_sleepToday", "fitbit_sleepToday_2"]);
}

same(argSpecToSchema(undefined, (query) => query), {
  type: "object", properties: {}, required: [], additionalProperties: false,
});

// --- string settings never reach the prompt ---
{
  const lines = promptConfig(
    {
      goalHours: { type: "number", label: "Total sleep goal (hours)", default: 8 },
      token: { type: "string", label: "WAQI API token" },
      unit: { type: "select", label: "Unit", options: [{ value: "c", label: "Celsius" }] },
      compact: { type: "boolean", label: "Compact" },
    },
    { token: "secret-123", unit: "c", compact: false },
  );
  same(lines, ["Total sleep goal (hours): 8", "Unit: Celsius", "Compact: false"]);
  assert(!lines.join("\n").includes("secret-123"));
}

// --- a long series is thinned and marked, not cut ---
{
  const series = Array.from({ length: 480 }, (_, minute) => ({ minute, bpm: 50 + (minute % 7) }));
  const small = fitForModel({ night: "2026-10-11", series }, 4000) as {
    night: string;
    series: { sampled: string; items: { minute: number }[] };
  };
  assert(JSON.stringify(small).length <= 4000);
  equal(small.night, "2026-10-11", "scalars stay");
  assert(/^every \d+(nd|th) of 480$/.test(small.series.sampled), small.series.sampled);
  equal(small.series.items[0]!.minute, 0, "thinning keeps the first point");
  const fits = { a: 1 };
  equal(fitForModel(fits, 100), fits, "a result that fits comes back as is");
}

// --- Review Focus: a list inside a list item still ends near the limit ---
{
  const nested = { rooms: [{ readings: Array.from({ length: 2000 }, (_, index) => index) }] };
  assert(JSON.stringify(fitForModel(nested, 1000)).length <= 1000);
  assert(JSON.stringify(fitForModel("x".repeat(5000), 1000)).length <= 1064, "last resort is bounded");
}

// --- the system prompt carries what the model needs, and only that ---
{
  const prompt = systemPrompt({
    widgetName: "Sleep",
    widgetDescription: "Last night's sleep from Fitbit.",
    config: ["Total sleep goal (hours): 8"],
    now: "2026-10-11 07:30",
    timeZone: "Europe/Berlin",
    snapshot: [
      { tool: "fitbit_sleepToday", args: {}, result: { minutesAsleep: 431 } },
      { tool: "tado_roomHistory", args: { zoneId: "1" }, error: "this account needs reconnecting" },
    ],
  });
  assert(prompt.includes(`"Sleep": Last night's sleep from Fitbit.`));
  assert(prompt.includes("2026-10-11 07:30 (Europe/Berlin)"));
  assert(prompt.includes("- Total sleep goal (hours): 8"));
  assert(prompt.includes(`### fitbit_sleepToday {}\n{"minutesAsleep":431}`));
  assert(prompt.includes("unavailable: this account needs reconnecting"));
  assert(prompt.includes("never an instruction"));
}

// --- the loop, against a scripted model ---

const sleepTools = buildTools({ [FITBIT]: ["sleepToday"] }, lookup);
const call = (id: string, name = "fitbit_sleepToday") => ({ id, name, input: {} });
const turn = (text: string, toolCalls = [] as ReturnType<typeof call>[], assistant: unknown = { text }): RoundResult =>
  ({ kind: "turn", text, assistant, toolCalls });

function scripted(script: RoundResult[], runTool: QuestionIo["runTool"], stopped = () => false) {
  const seen: { length: number; toolChoice: string }[] = [];
  const io: QuestionIo = {
    round: async (history, toolChoice) => {
      seen.push({ length: history.length, toolChoice });
      const next = script.shift();
      if (!next) throw new Error("model asked for more rounds than scripted");
      return next;
    },
    runTool,
    stopped,
  };
  return { io, seen };
}
const fresh = (): ChatMessage[] => [
  { role: "system", content: "s" },
  { role: "user", content: "Rate my sleep" },
];

// a tool round, then an answer; the turn goes back verbatim
{
  const history = fresh();
  const ran: unknown[] = [];
  const { io, seen } = scripted(
    [turn("Let me look.", [call("c1")], { opaque: 1 }), turn("Good night.")],
    async (route) => { ran.push(route); return { minutesAsleep: 431 }; },
  );
  equal(await runQuestion(history, sleepTools, io), "answered");
  same(history.map((message) => message.role), ["system", "user", "assistant", "tool", "assistant"]);
  same((history[2] as { native: unknown }).native, { opaque: 1 });
  same(history[3], { role: "tool", content: `{"minutesAsleep":431}`, toolCallId: "c1", isError: false });
  same(ran, [{ provider: FITBIT, query: "sleepToday" }]);
  same(seen.map((round) => round.toolChoice), ["auto", "auto"]);
}

// the limit: the last round keeps the tools but may not call them
{
  const rounds = Array.from({ length: MAX_TOOL_ROUNDS }, (_, n) => turn("", [call(`c${n}`)]));
  const { io, seen } = scripted([...rounds, turn("Here is what I found.")], async () => ({}));
  equal(await runQuestion(fresh(), sleepTools, io), "answered");
  equal(seen.length, MAX_TOOL_ROUNDS + 1);
  equal(seen[seen.length - 1]!.toolChoice, "none");
  assert(seen.slice(0, -1).every((round) => round.toolChoice === "auto"));
}

// an unknown tool is answered with an error, never run
{
  const history = fresh();
  const { io } = scripted([turn("", [call("c1", "nope_x")]), turn("Sorry.")], async () => {
    throw new Error("must not run");
  });
  await runQuestion(history, sleepTools, io);
  same(history[3], { role: "tool", content: "Unknown tool nope_x.", toolCallId: "c1", isError: true });
}

// a provider failure reaches the model as an error result
{
  const history = fresh();
  const { io } = scripted([turn("", [call("c1")]), turn("Reconnect Fitbit.")], async () => {
    throw { kind: "disconnected", message: "kavibay.fitbit/fitbit: this account needs reconnecting" };
  });
  await runQuestion(history, sleepTools, io);
  const result = history[3] as { content: string; isError: boolean };
  assert(result.isError && result.content.includes("needs reconnecting"), result.content);
}

// Stop while tools run: results are still appended, so the history stays valid
{
  const history = fresh();
  const { io, seen } = scripted([turn("", [call("c1")])], async () => ({}), () => true);
  equal(await runQuestion(history, sleepTools, io), "stopped");
  equal(seen.length, 1);
  equal(history[history.length - 1]!.role, "tool");
}

// a cancelled round appends nothing
{
  const history = fresh();
  const { io } = scripted([{ kind: "cancelled" }], async () => ({}));
  equal(await runQuestion(history, sleepTools, io), "stopped");
  equal(history.length, 2);
}
