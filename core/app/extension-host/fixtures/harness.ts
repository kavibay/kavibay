import type { ArgSpec } from "@sdk/contract/sdk";
import type { Fetcher } from "../http";
import type { HostUi } from "../runtime";

/**
 * Ported unchanged from docs/extension-sdk-reference/harness.ts (Phase 1).
 * Fake provider API, scripted UI, and the assertion counter the suite reports
 * against. No network, no DOM, no test framework — same as every other
 * `*.assert.ts` in this repo.
 */

export const rooms = [{ id: "living-room", name: "Living Room" }, { id: "bedroom", name: "Bedroom" }];
export const calendars = [{ id: "primary", name: "Alex" }];

export function makeFetcher() {
  const calls: string[] = [];
  const fetcher: Fetcher = async (url) => {
    calls.push(url);
    if (url.includes("/rooms/") && url.includes("/state")) {
      const roomId = url.split("/rooms/")[1]!.split("/")[0]!;
      return { roomId, current: 20.5, target: 21, heating: false };
    }
    if (url.includes("/api/v2/rooms")) return rooms;
    if (url.includes("calendarList")) return calendars;
    if (url.includes("/events")) return [{ id: "e1", title: "Standup", start: "09:00", conferenceUrl: "https://meet.example/x" }];
    if (url.includes("open-meteo")) return { current: { temperature_2m: 18.2 } };
    return {};
  };
  return { fetcher, calls };
}

export function makeUi(answers: Record<string, string | number | boolean>, confirmWith = true) {
  const log: string[] = [];
  const ui: HostUi = {
    async prompt(spec: ArgSpec & { name: string; options?: { value: string | number; label: string }[] }) {
      log.push(`prompt:${spec.name}${spec.options ? `[${spec.options.map((o) => o.value).join(",")}]` : ""}`);
      return answers[spec.name];
    },
    async confirm(message) { log.push(`confirm:${message}`); return confirmWith; },
    notify(message) { log.push(`notify:${message}`); },
  };
  return { ui, log };
}

let passed = 0, failed = 0;
export const check = (name: string, cond: boolean, detail = "") => {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name} ${detail}`); }
};
export const summary = () => { console.log(`\n${passed} passed, ${failed} failed`); return failed; };
export async function caught(fn: () => Promise<unknown>): Promise<any> {
  try { await fn(); return undefined; } catch (e) { return e; }
}
