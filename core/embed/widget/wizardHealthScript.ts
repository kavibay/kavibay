/**
 * The hero video's incident: is checkout up, and a button that restarts it.
 *
 * Both halves of a widget at once. It reads through its own `api.json` — three
 * health endpoints, the hosts the person approves — and it writes through a
 * provider, n8n's `triggerWebhook`, which runs the person's restart workflow.
 * On the landing page the app answers both (core/web/webProviders.ts):
 * checkout times out until the webhook is called, then comes back.
 *
 * The prose is unwrapped on purpose; see wizardScript.ts.
 */
import type { DemoPromptPart, WizardDemoScript } from "./wizardDemoScript";

const PROMPTS: DemoPromptPart[][] = [
  [
    "checkout, api and web on acme.dev: up or down? restart checkout via ",
    { mention: "n8n" },
    "webhook restart-checkout",
  ],
];

/** Only the finished widget has it; see INBOX_FINAL_MARKER. */
export const HEALTH_FINAL_MARKER = "SERVICE_HEALTH_READY";

const MANIFEST = `{
  "name": "service-health",
  "version": "1.0.0",
  "displayName": "Service health",
  "description": "Checkout, API and website on acme.dev, with a restart for checkout.",
  "engines": { "kavibay": "^0.1" },
  "widget": {
    "name": "tile",
    "displayName": "Service health",
    "defaultSize": { "w": 2, "h": 2 },
    "requires": {
      "providers": [{ "id": "kavibay.n8n/n8n", "actions": ["triggerWebhook"] }]
    }
  }
}`;

const API_JSON = `{
  "schemaVersion": 1,
  "endpoints": [
    { "id": "checkout", "description": "Checkout's health check.", "method": "GET", "url": "https://checkout.acme.dev/health" },
    { "id": "api", "description": "The API's health check.", "method": "GET", "url": "https://api.acme.dev/health" },
    { "id": "web", "description": "The website's front page.", "method": "GET", "url": "https://acme.dev/" }
  ]
}`;

const INDEX_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<style>
  html, body {
    height: 100%;
    margin: 0;
    background: transparent;
    color-scheme: var(--native-color-scheme, dark);
    font-family: var(--font-family, system-ui, sans-serif);
  }
  #kavibay-widget {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 0 2px;
    color: rgba(255, 255, 255, 0.92);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 9px;
    min-height: 36px;
    padding: 0 6px 0 8px;
    border-radius: 8px;
  }
  .row.down {
    background: rgba(255, 90, 90, 0.12);
  }
  .dot {
    flex: none;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: #3ddc84;
    box-shadow: 0 0 0 3px rgba(61, 220, 132, 0.18);
  }
  .down .dot {
    background: #ff5a5a;
    box-shadow: 0 0 0 3px rgba(255, 90, 90, 0.22);
  }
  .busy .dot {
    background: #f5c542;
    box-shadow: 0 0 0 3px rgba(245, 197, 66, 0.2);
  }
  .name {
    flex: 1;
    min-width: 0;
    font-size: 13px;
    font-weight: 600;
  }
  .host {
    display: block;
    font-size: 11px;
    font-weight: 400;
    color: rgba(255, 255, 255, 0.45);
  }
  .state {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.6);
  }
  .state[hidden] {
    display: none;
  }
  button {
    padding: 5px 10px;
    border: 0;
    border-radius: 7px;
    background: #ea4b71;
    color: #fff;
    font: inherit;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }
  button[hidden] {
    display: none;
  }
  .checked {
    margin: 2px 8px 0;
    font-size: 11px;
    color: rgba(255, 255, 255, 0.4);
  }
</style>
</head>
<body>
<div id="kavibay-widget"></div>
<script src="@kavibay/contract.js"></script>
<script src="widget.js"></script>
</body>
</html>`;

const WIDGET_JS = `const ${HEALTH_FINAL_MARKER} = true;
const N8N = "kavibay.n8n/n8n";
const SERVICES = [
  { id: "checkout", name: "Checkout", host: "checkout.acme.dev", webhook: "restart-checkout" },
  { id: "api", name: "API", host: "api.acme.dev" },
  { id: "web", name: "Website", host: "acme.dev" },
];
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

kavibayWidget.define({
  async setup(ctx) {
    const check = async (service) => (await ctx.endpoint(service.id, {})).ok;
    const checkAll = () => Promise.all(SERVICES.map(check));
    return {
      up: await checkAll(),
      check,
      checkAll,
      restart: (service) => ctx.providers[N8N].action("triggerWebhook", { webhook: service.webhook, method: "POST" }),
    };
  },

  render(model, root) {
    const checked = document.createElement("p");
    checked.className = "checked";

    const rows = SERVICES.map((service) => {
      const row = document.createElement("div");
      const dot = document.createElement("span");
      dot.className = "dot";
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = service.name;
      const host = document.createElement("span");
      host.className = "host";
      host.textContent = service.host;
      name.appendChild(host);
      const state = document.createElement("span");
      state.className = "state";
      row.append(dot, name, state);

      let button = null;
      if (service.webhook) {
        button = document.createElement("button");
        button.type = "button";
        button.textContent = "Restart";
        button.addEventListener("click", async () => {
          button.hidden = true;
          state.hidden = false;
          row.className = "row busy";
          state.textContent = "Restarting…";
          try {
            await model.restart(service);
            // Back when it answers again; give up after half a minute.
            for (let i = 0; i < 20 && !(await model.check(service)); i++) await sleep(1500);
          } catch {
            state.textContent = "Restart failed";
          }
          paint(await model.checkAll());
        });
        row.appendChild(button);
      }
      return { row, state, button };
    });

    const paint = (up) => {
      rows.forEach(({ row, state, button }, i) => {
        row.className = "row" + (up[i] ? "" : " down");
        state.textContent = up[i] ? "Up" : "Down";
        // Down with a way back: the button says it, red, where the state would be.
        if (button) button.hidden = up[i];
        state.hidden = Boolean(button) && !up[i];
      });
      checked.textContent = "Checked " + new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    };
    paint(model.up);
    setInterval(async () => paint(await model.checkAll()), 30000);

    root.append(...rows.map(({ row }) => row), checked);
  },
});`;

export const HEALTH_DEMO: WizardDemoScript = {
  id: "service-health",
  draftId: "service-health",
  resultRow: "service-health",
  resultQuery: "service health",
  steps: ["Searching", "Wizard open", "Widget built", "On the desk"],
  prompts: PROMPTS,
  replies: [
    `Here’s acme.dev at a glance: checkout, the API and the website, checked every 30 seconds. When one is down its row turns red; checkout gets a Restart button that runs your n8n webhook restart-checkout and watches until it answers again.

\`\`\`json path=manifest.json
${MANIFEST}
\`\`\`

\`\`\`json path=api.json
${API_JSON}
\`\`\`

\`\`\`html path=index.html
${INDEX_HTML}
\`\`\`

\`\`\`js path=widget.js
${WIDGET_JS}
\`\`\``,
  ],
  finalMarker: HEALTH_FINAL_MARKER,
};
