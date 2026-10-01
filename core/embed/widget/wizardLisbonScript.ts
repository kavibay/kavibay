/**
 * The third recording: a countdown to a trip.
 *
 * Two turns, like the water tracker: ask for a countdown to a Lisbon trip,
 * then for a bar that fills from the day it was booked. Same runtime-package
 * shape as `wizardScript.ts` (see its notes on manifests and unwrapped prose).
 *
 * The departure is always 12 days, 4 h 31 min out, computed when the widget
 * loads. A fixed date in a recording runs out; this one never shows a trip
 * that has already left, and always opens on "12 days".
 */

import type { WizardDemoScript } from "./wizardDemoScript";

const MANIFEST = `{
  "id": "lisbon-trip",
  "name": "Lisbon Trip",
  "version": "1.0.0",
  "description": "Days, hours and minutes until the flight to Lisbon.",
  "ui": {
    "entry": "index.html",
    "defaultOffset": { "x": 0, "y": 0 },
    "defaultSize": { "w": 280, "h": 200 }
  },
  "commands": [],
  "permissions": []
}`;

const INDEX_HTML = `<div id="kavibay-widget"></div>
<style>
  #kavibay-widget {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 2px;
  }
  .days {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin: 0;
  }
  .days b {
    font-size: 52px;
    font-weight: 800;
    line-height: 1;
    letter-spacing: -0.03em;
    font-variant-numeric: tabular-nums;
  }
  .days span {
    font-size: 20px;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.55);
  }
  .clock {
    margin: 0;
    font-family: "JetBrains Mono Variable", ui-monospace, "Cascadia Mono", Consolas, monospace;
    font-size: 26px;
    letter-spacing: 0.04em;
    font-variant-numeric: tabular-nums;
  }
  .bar {
    height: 6px;
    margin-top: 4px;
    border-radius: 3px;
    background: rgba(255, 255, 255, 0.12);
    overflow: hidden;
  }
  .bar i {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: linear-gradient(90deg, #f5b26b, #f06b9a, #9b7bf5);
  }
  .note {
    margin: 0;
    font-size: 12px;
    color: rgba(255, 255, 255, 0.5);
  }
</style>
<script src="@kavibay/runtime.js"></script>
<script src="widget.js"></script>`;

/** Turn one has no bar; turn two flips this one constant. */
function widgetJs(showProgress: boolean): string {
  return `const SHOW_PROGRESS = ${showProgress};
const BOOKED_DAYS_BEFORE = 60;

// The flight to Lisbon (LIS): 12 days, 4 h 31 min from now.
const departs = new Date(Date.now() + ((12 * 24 + 4) * 60 + 31) * 60000 + 10000);
const booked = new Date(departs.getTime() - BOOKED_DAYS_BEFORE * 86400000);

const root = document.getElementById("kavibay-widget");
const pad = (n) => String(n).padStart(2, "0");

const days = document.createElement("p");
days.className = "days";
const dayCount = document.createElement("b");
const dayLabel = document.createElement("span");
days.append(dayCount, dayLabel);

const clock = document.createElement("p");
clock.className = "clock";

const bar = document.createElement("div");
bar.className = "bar";
const fill = document.createElement("i");
bar.appendChild(fill);

const note = document.createElement("p");
note.className = "note";
const date = departs.toLocaleDateString("en-US", { month: "short", day: "numeric" });
const time = pad(departs.getHours()) + ":" + pad(departs.getMinutes());
note.textContent = "Departs " + date + " · " + time + " LIS";

root.append(days, clock);
if (SHOW_PROGRESS) root.appendChild(bar);
root.appendChild(note);

function render() {
  const now = Date.now();
  const left = Math.max(0, departs.getTime() - now);
  const d = Math.floor(left / 86400000);
  const h = Math.floor(left / 3600000) % 24;
  const m = Math.floor(left / 60000) % 60;
  const s = Math.floor(left / 1000) % 60;
  dayCount.textContent = String(d);
  dayLabel.textContent = d === 1 ? "day" : "days";
  clock.textContent = pad(h) + ":" + pad(m) + ":" + pad(s);
  const done = (now - booked.getTime()) / (departs.getTime() - booked.getTime());
  fill.style.width = Math.min(100, Math.max(0, done * 100)).toFixed(1) + "%";
}

render();
setInterval(render, 1000);`;
}

function reply(prose: string, showProgress: boolean): string {
  return `${prose}

\`\`\`json path=manifest.json
${MANIFEST}
\`\`\`

\`\`\`html path=index.html
${INDEX_HTML}
\`\`\`

\`\`\`js path=widget.js
${widgetJs(showProgress)}
\`\`\``;
}

export const LISBON_REPLIES = [
  reply("Here’s your countdown: days up top, then hours, minutes and seconds, ticking.", false),
  reply("Added a bar that fills from the day you booked to take-off.", true),
];

export const LISBON_DEMO: WizardDemoScript = {
  id: "lisbon-countdown",
  draftId: "lisbon-trip",
  resultRow: "lisbon-trip",
  resultQuery: "lisbon trip",
  steps: ["Searching", "Wizard open", "First version", "Change applied", "On the desk"],
  prompts: [["a countdown to my Lisbon trip"], ["add a progress bar since I booked it"]],
  replies: LISBON_REPLIES,
  finalMarker: "SHOW_PROGRESS = true",
};
