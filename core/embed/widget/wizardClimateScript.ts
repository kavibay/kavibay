/**
 * The room-climate widget the fourth landing demo builds.
 *
 * Two turns: the rooms from tado° with temperature and humidity, then Berlin's
 * air quality from Open-Meteo beside them. A contract package like the inbox
 * (wizardInboxScript.ts): it asks the tado° provider for `zones` and
 * `zoneStates` and the weather provider for `airQuality`, and on the landing
 * page the app answers those providers' HTTP calls (core/web/webProviders.ts),
 * so the readings pass through the shipping provider code.
 *
 * The prose is unwrapped on purpose; see wizardScript.ts.
 */
import type { DemoPromptPart, WizardDemoScript } from "./wizardDemoScript";

/** What the visitor types. Mentions are picked from the Integrations menu. */
const PROMPTS: DemoPromptPart[][] = [
  ["show temp and humidity in my rooms. use ", { mention: "tado°", query: "tado" }],
  ["also show AQI in berlin ", { mention: "Weather (Open-Meteo)", query: "weather" }],
];

/** Only the finished widget has it; see INBOX_FINAL_MARKER. */
export const CLIMATE_FINAL_MARKER = "CLIMATE_DEMO_AQI";

function manifest(withAir: boolean): string {
  const weather = withAir ? `,\n        { "id": "kavibay.weather/weather", "queries": ["airQuality"] }` : "";
  return `{
  "name": "room-climate",
  "version": "1.0.0",
  "displayName": "Room climate",
  "description": "Temperature and humidity in every room${withAir ? ", and the air outside" : ""}.",
  "engines": { "kavibay": "^0.1" },
  "widget": {
    "name": "tile",
    "displayName": "Room climate",
    "defaultSize": { "w": 2, "h": 2 },
    "requires": {
      "providers": [
        { "id": "kavibay.tado/tado", "queries": ["zones", "zoneStates"] }${weather}
      ]
    }
  }
}`;
}

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
    gap: 0;
    padding: 0 2px;
    color: rgba(255, 255, 255, 0.92);
  }
  .row {
    display: flex;
    align-items: baseline;
    gap: 10px;
    padding: 3px 6px;
    border-radius: 8px;
  }
  .row:hover {
    background: rgba(255, 255, 255, 0.06);
  }
  .name {
    flex: 1;
    min-width: 0;
    font-size: 13px;
    font-weight: 600;
  }
  .temp {
    font-size: 16px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .hum {
    width: 52px;
    text-align: right;
    font-size: 12px;
    color: rgba(110, 180, 255, 0.9);
    font-variant-numeric: tabular-nums;
  }
  .air {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 4px;
    padding: 6px 6px 0;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
  }
  .air .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
  }
  .air .label {
    flex: 1;
    font-size: 12px;
    color: rgba(255, 255, 255, 0.6);
  }
  .air .value {
    font-size: 13px;
    font-weight: 600;
  }
</style>
</head>
<body>
<div id="kavibay-widget"></div>
<script src="@kavibay/contract.js"></script>
<script src="widget.js"></script>
</body>
</html>`;

function widgetJs(withAir: boolean): string {
  return `${withAir ? `const ${CLIMATE_FINAL_MARKER} = true;\n\n` : ""}const TADO = "kavibay.tado/tado";
${withAir ? `const WEATHER = "kavibay.weather/weather";
const AQI_COLORS = { Good: "#50f0e6", Fair: "#50ccaa", Moderate: "#f0e641", Poor: "#ff5050", "Very poor": "#960032" };
` : ""}
const fmt = (value, unit, digits) => (value === null || value === undefined ? "–" : value.toFixed(digits) + unit);

kavibayWidget.define({
  async setup(ctx) {
    const [zones, states${withAir ? ", air" : ""}] = await Promise.all([
      ctx.providers[TADO].query("zones", {}),
      ctx.providers[TADO].query("zoneStates", {}),${withAir ? `
      ctx.providers[WEATHER].query("airQuality", { location: "Berlin" }),` : ""}
    ]);
    const byId = new Map(states.map((state) => [state.id, state]));
    const rooms = zones.map((zone) => ({ name: zone.name, ...byId.get(zone.id) }));
    return { rooms${withAir ? ", air" : ""} };
  },

  render(model, root) {
    for (const room of model.rooms) {
      const row = document.createElement("div");
      row.className = "row";
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = room.name;
      const temp = document.createElement("span");
      temp.className = "temp";
      temp.textContent = fmt(room.temperature, "°", 1);
      const hum = document.createElement("span");
      hum.className = "hum";
      hum.textContent = fmt(room.humidity, "%", 0);
      row.append(name, temp, hum);
      root.appendChild(row);
    }${withAir ? `

    const air = document.createElement("div");
    air.className = "air";
    const dot = document.createElement("span");
    dot.className = "dot";
    dot.style.background = AQI_COLORS[model.air.level] ?? "#888";
    const label = document.createElement("span");
    label.className = "label";
    label.textContent = "Air quality · " + model.air.place;
    const value = document.createElement("span");
    value.className = "value";
    value.textContent = model.air.aqi === null ? "–" : model.air.aqi + " · " + model.air.level;
    air.append(dot, label, value);
    root.appendChild(air);` : ""}
  },
});`;
}

function reply(prose: string, withAir: boolean): string {
  return `${prose}

\`\`\`json path=manifest.json
${manifest(withAir)}
\`\`\`

\`\`\`html path=index.html
${INDEX_HTML}
\`\`\`

\`\`\`js path=widget.js
${widgetJs(withAir)}
\`\`\``;
}

export const CLIMATE_DEMO: WizardDemoScript = {
  id: "tado-room-climate",
  draftId: "room-climate",
  resultRow: "room-climate",
  resultQuery: "room climate",
  steps: ["Searching", "Wizard open", "First version", "Change applied", "On the desk"],
  prompts: PROMPTS,
  replies: [
    reply("Here are your rooms from tado°: temperature, and humidity beside it.", false),
    reply("Added Berlin’s air quality below the rooms, from Open-Meteo’s European AQI.", true),
  ],
  finalMarker: CLIMATE_FINAL_MARKER,
};
