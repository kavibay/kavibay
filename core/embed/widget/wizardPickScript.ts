/**
 * Point at it instead of describing it.
 *
 * Turn one builds a weekly running goal. For turn two the tour uses the
 * Wizard's point-and-prompt: "Select preview elements", a click on the
 * distance in the preview, and three words — "make this bigger". The chip in
 * the composer carries which element was meant, so the prompt does not have to.
 *
 * A runtime package, like the water tracker; see wizardScript.ts for the
 * manifest rules and why the prose is unwrapped.
 */
import type { WizardDemoScript } from "./wizardDemoScript";

const MANIFEST = `{
  "id": "running-goal",
  "name": "Running",
  "version": "1.0.0",
  "description": "Kilometres run this week, against the weekly goal.",
  "ui": {
    "entry": "index.html",
    "defaultOffset": { "x": 0, "y": 0 },
    "defaultSize": { "w": 290, "h": 212 }
  },
  "commands": [],
  "permissions": []
}`;

function indexHtml(kmSize: number): string {
  return `<div id="kavibay-widget"></div>
<style>
  #kavibay-widget {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 2px;
  }
  .km {
    margin: 0;
    font-size: ${kmSize}px;
    font-weight: 700;
    line-height: 1;
    letter-spacing: -0.02em;
    font-variant-numeric: tabular-nums;
  }
  .km span {
    margin-left: 4px;
    font-size: 0.45em;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.55);
  }
  .goal {
    margin: 0;
    font-size: 12px;
    color: rgba(255, 255, 255, 0.5);
  }
  .bar {
    height: 6px;
    border-radius: 3px;
    background: rgba(255, 255, 255, 0.12);
    overflow: hidden;
  }
  .bar i {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: linear-gradient(90deg, #ff8a3d, #ff5e7a);
  }
  .days {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    height: 40px;
  }
  .day {
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    align-items: center;
    gap: 4px;
    height: 100%;
    font-size: 10px;
    color: rgba(255, 255, 255, 0.45);
  }
  .day b {
    width: 22px;
    border-radius: 3px;
    background: #ff7a50;
  }
</style>
<script src="@kavibay/runtime.js"></script>
<script src="widget.js"></script>`;
}

function widgetJs(final: boolean): string {
  return `${final ? "const PICK_DEMO_BIGGER = true;\n" : ""}const GOAL_KM = 25;
// Monday to Sunday; today is Thursday.
const RUNS = [5.2, 0, 7.4, 5.8, null, null, null];

const root = document.getElementById("kavibay-widget");
const total = RUNS.reduce((sum, km) => sum + (km ?? 0), 0);

const km = document.createElement("p");
km.className = "km";
km.id = "distance";
km.innerHTML = total.toFixed(1) + "<span>km</span>";

const goal = document.createElement("p");
goal.className = "goal";
goal.textContent = "of " + GOAL_KM + " km this week · " + (GOAL_KM - total).toFixed(1) + " to go";

const bar = document.createElement("div");
bar.className = "bar";
const fill = document.createElement("i");
fill.style.width = Math.min(100, (total / GOAL_KM) * 100) + "%";
bar.appendChild(fill);

const days = document.createElement("div");
days.className = "days";
"MTWTFSS".split("").forEach((letter, i) => {
  const day = document.createElement("span");
  day.className = "day";
  const run = document.createElement("b");
  run.style.height = Math.max(2, (RUNS[i] ?? 0) * 3) + "px";
  run.style.opacity = RUNS[i] ? "1" : "0.2";
  day.append(run, letter);
  days.appendChild(day);
});

root.append(km, goal, bar, days);`;
}

function reply(prose: string, final: boolean): string {
  return `${prose}

\`\`\`json path=manifest.json
${MANIFEST}
\`\`\`

\`\`\`html path=index.html
${indexHtml(final ? 52 : 30)}
\`\`\`

\`\`\`js path=widget.js
${widgetJs(final)}
\`\`\``;
}

export const PICK_REPLIES = [
  reply("Here’s your week: kilometres so far, the goal, and a bar per day.", false),
  reply("Made the distance bigger — it’s the first thing you see now.", true),
];

export const PICK_DEMO: WizardDemoScript = {
  id: "point-and-prompt",
  draftId: "running-goal",
  resultRow: "running-goal",
  resultQuery: "running",
  steps: ["Searching", "Wizard open", "First version", "Change applied", "On the desk"],
  prompts: [["my weekly running goal, 25 km"], ["make this bigger"]],
  pick: { before: 1, selector: "#distance" },
  replies: PICK_REPLIES,
  finalMarker: "PICK_DEMO_BIGGER",
};
