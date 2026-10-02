/**
 * Built from a picture: a status page screenshot goes into the composer, the
 * prompt is four words, and the widget comes back in the desk's own style.
 *
 * The screenshot is `core/web/assets/status-screenshot.png`, attached by the
 * tour the way a person pastes one (the script names it, webTour.ts attaches
 * it). The numbers are the screenshot's: there is no status API behind this,
 * and the reply says so rather than pretending to watch real services.
 *
 * A runtime package, like the water tracker; see wizardScript.ts for the
 * manifest rules and why the prose is unwrapped.
 */
import type { WizardDemoScript } from "./wizardDemoScript";

const MANIFEST = `{
  "id": "service-status",
  "name": "Service status",
  "version": "1.0.0",
  "description": "Uptime of four services over the last 30 days.",
  "ui": {
    "entry": "index.html",
    "defaultOffset": { "x": 0, "y": 0 },
    "defaultSize": { "w": 300, "h": 200 }
  },
  "commands": [],
  "permissions": []
}`;

const INDEX_HTML = `<div id="kavibay-widget"></div>
<style>
  #kavibay-widget {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 0 2px;
  }
  .badge {
    align-self: flex-start;
    margin: 0 0 6px;
    padding: 2px 8px;
    border-radius: 999px;
    background: rgba(63, 185, 80, 0.16);
    color: #56d364;
    font-size: 11px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 0;
  }
  .dot {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }
  .name {
    flex: 1;
    font-size: 13px;
    font-weight: 600;
  }
  .up {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.6);
    font-variant-numeric: tabular-nums;
  }
  .bars {
    display: flex;
    gap: 1px;
  }
  .bars i {
    width: 2px;
    height: 12px;
    border-radius: 1px;
  }
</style>
<script src="@kavibay/runtime.js"></script>
<script src="widget.js"></script>`;

const WIDGET_JS = `const STATUS_DEMO_READY = true;
const OK = "#3fb950";
const WARN = "#d29922";

// From the screenshot: uptime over 30 days, and which of the last 20 days dipped.
const SERVICES = [
  { name: "API", uptime: "99.98%", dips: [] },
  { name: "Web app", uptime: "99.95%", dips: [] },
  { name: "Database", uptime: "99.71%", dips: [9, 15] },
  { name: "Workers", uptime: "100.00%", dips: [] },
];

const root = document.getElementById("kavibay-widget");

const badge = document.createElement("p");
badge.className = "badge";
badge.textContent = "All systems operational";
root.appendChild(badge);

for (const service of SERVICES) {
  const row = document.createElement("div");
  row.className = "row";

  const dot = document.createElement("span");
  dot.className = "dot";
  dot.style.background = service.dips.length ? WARN : OK;

  const name = document.createElement("span");
  name.className = "name";
  name.textContent = service.name;

  const up = document.createElement("span");
  up.className = "up";
  up.textContent = service.uptime;

  const bars = document.createElement("span");
  bars.className = "bars";
  for (let day = 0; day < 20; day++) {
    const bar = document.createElement("i");
    bar.style.background = service.dips.includes(day) ? WARN : OK;
    bars.appendChild(bar);
  }

  row.append(dot, name, up, bars);
  root.appendChild(row);
}`;

export const STATUS_DEMO: WizardDemoScript = {
  id: "screenshot-status",
  draftId: "service-status",
  resultRow: "service-status",
  resultQuery: "service status",
  steps: ["Searching", "Wizard open", "Widget built", "On the desk"],
  attachment: "status-screenshot",
  prompts: [["make this a widget"]],
  replies: [
    `Rebuilt your status card for the desk: the four services, their 30-day uptime, and the day bars, with the Database dips in amber. The numbers are the ones in your screenshot. Tell me where your status comes from — an API or a status page URL — and I'll make them live.

\`\`\`json path=manifest.json
${MANIFEST}
\`\`\`

\`\`\`html path=index.html
${INDEX_HTML}
\`\`\`

\`\`\`js path=widget.js
${WIDGET_JS}
\`\`\``,
  ],
  finalMarker: "STATUS_DEMO_READY",
};

export const STATUS_REPLIES = STATUS_DEMO.replies;
