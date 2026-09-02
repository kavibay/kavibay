// SPDX-License-Identifier: MIT
import { calendarWidget } from "./widgets/calendar";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const calendars = calendarWidget.configuration?.calendars;
assert(calendars?.type === "select", "calendar settings use a select field");
assert(calendars?.multiple === true, "calendar settings allow multiple calendars");
assert(calendars?.required === true, "calendar settings require one or more calendars");
assert(calendars?.source?.query === "calendars", "calendar settings load provider calendars");

console.log("calendarConfig.assert.ts: ok");
