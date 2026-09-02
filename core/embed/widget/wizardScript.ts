/**
 * The recording the Widget Wizard demo plays back.
 *
 * Two turns, the same two the landing page's hand-built demo shows, with the
 * same words and the same resulting widget: ask for a water tracker, then ask
 * for a percentage next to the value. Keeping them identical is the point — a
 * visitor who sees that section on the marketing page and then opens this
 * showcase should recognise it, and the two must not drift into telling
 * different stories about the same product.
 *
 * Shapes are the host's, not invented here: `DEMO_MODELS` matches
 * `LlmModelOption` as `src-tauri/src/llm/catalog.rs` serializes it (camelCase),
 * the replies are in the fenced `path=` format that the shipping
 * `parseGeneratedFiles` reads, and their manifests satisfy the shipping
 * `validateRuntimeManifest`.
 *
 * That last one was learned the hard way. A first version wrote a *contract*
 * manifest — `format`, `displayName`, `widgets` — into what it called a runtime
 * package. A runtime manifest is keyed by `id`, so the Wizard read `undefined`,
 * told the person the package had a problem and asked the model for a fix,
 * which produced the same reply again. The demo looped in front of the visitor.
 * `scripts/wizardPreviewDocument.assert.ts` now runs the host's own validator
 * over every reply.
 *
 * THE PROSE IS UNWRAPPED ON PURPOSE. It was once hard-wrapped at about 72
 * characters like these comments; the transcript wrapped it again at its own
 * width and kept the original breaks too, so a sentence arrived ragged. A model
 * writes paragraphs and lets the client wrap them.
 */

/**
 * Two models, both marked configured, so the picker has something to show and
 * the Wizard does not open on a "connect an account first" state that this
 * page has no way to satisfy.
 */
export const DEMO_MODELS = [
  {
    id: "claude-fable-5",
    label: "Claude Fable 5",
    note: "Anthropic's most capable generally available model",
    description: "Next-generation intelligence for long-running agents.",
    provider: "anthropic",
    vendor: "anthropic",
    context: { windowTokens: 1_000_000, maxOutputTokens: 128_000 },
    pricing: { currency: "USD", unitTokens: 1_000_000, input: 10, output: 50 },
    capabilities: ["text", "vision", "reasoning", "streaming"],
    effortLevels: ["low", "medium", "high"],
    authoringDefault: true,
    sourceUrl: "https://docs.claude.com/en/docs/about-claude/models",
    credentialType: "anthropic-api-key",
    configured: true,
    enabled: true,
  },
  {
    id: "claude-sonnet-5",
    label: "Claude Sonnet 5",
    note: "Balanced speed and capability",
    description: "A good default for widget authoring.",
    provider: "anthropic",
    vendor: "anthropic",
    context: { windowTokens: 1_000_000, maxOutputTokens: 64_000 },
    pricing: { currency: "USD", unitTokens: 1_000_000, input: 3, output: 15 },
    capabilities: ["text", "vision", "streaming"],
    effortLevels: ["low", "medium", "high"],
    authoringDefault: false,
    sourceUrl: "https://docs.claude.com/en/docs/about-claude/models",
    credentialType: "anthropic-api-key",
    configured: true,
    enabled: true,
  },
];

/** What the visitor "types". Both strings are the landing page's own. */
export const DEMO_PROMPTS = [
  "a tracker for how much water I drink today",
  "add percentage to value",
];

/** The manifest both turns write. Identical: only the view changes. */
const MANIFEST = `{
  "id": "water-tracker",
  "name": "Water",
  "version": "1.0.0",
  "description": "How much water you drank today.",
  "ui": {
    "entry": "index.html",
    "defaultOffset": { "x": 0, "y": 0 },
    "defaultSize": { "w": 260, "h": 210 }
  },
  "commands": [],
  "permissions": []
}`;

/**
 * The document, in both turns.
 *
 * Written twice unchanged rather than only in the first reply: the Wizard
 * writes a complete file set per turn, and an omitted file is a deleted file.
 */
const INDEX_HTML = `<div id="kavibay-widget"></div>
<style>
  #kavibay-widget {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 2px;
  }
  .value {
    display: flex;
    align-items: baseline;
    gap: 10px;
  }
  .amount {
    margin: 0;
    font-size: 30px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .pct {
    margin: 0;
    font-size: 15px;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.55);
    font-variant-numeric: tabular-nums;
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
    background: linear-gradient(90deg, #4a8fe0, #6aa9ff);
    transition: width 0.35s ease;
  }
  .buttons {
    display: flex;
    gap: 8px;
  }
  .buttons button {
    flex: 1;
    padding: 7px 0;
    border: 1px solid rgba(255, 255, 255, 0.16);
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.06);
    color: inherit;
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }
  .buttons button:hover {
    background: rgba(255, 255, 255, 0.12);
  }
</style>
<script src="@kavibay/runtime.js"></script>
<script src="widget.js"></script>`;

/** Turn one has no percentage; turn two flips this one constant. */
function widgetJs(showPercent: boolean): string {
  return `const GOAL_ML = 3000;
const SHOW_PERCENT = ${showPercent};

const root = document.getElementById("kavibay-widget");
let ml = 1750;

function render() {
  const percent = Math.min(100, Math.round((ml / GOAL_ML) * 100));
  root.innerHTML = "";

  const value = document.createElement("div");
  value.className = "value";

  const amount = document.createElement("p");
  amount.className = "amount";
  amount.textContent = (ml / 1000).toFixed(2).replace(/0$/, "") + "L";
  value.appendChild(amount);

  if (SHOW_PERCENT) {
    const pct = document.createElement("p");
    pct.className = "pct";
    pct.textContent = percent + "%";
    value.appendChild(pct);
  }

  root.appendChild(value);

  const goal = document.createElement("p");
  goal.className = "goal";
  goal.textContent = "of 3 L today";
  root.appendChild(goal);

  const bar = document.createElement("div");
  bar.className = "bar";
  const fill = document.createElement("i");
  fill.style.width = percent + "%";
  bar.appendChild(fill);
  root.appendChild(bar);

  const buttons = document.createElement("div");
  buttons.className = "buttons";
  for (const step of [250, 500]) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "+" + step + " ml";
    button.addEventListener("click", () => {
      ml = Math.min(GOAL_ML, ml + step);
      render();
    });
    buttons.appendChild(button);
  }
  root.appendChild(buttons);
}

render();`;
}

function reply(prose: string, showPercent: boolean): string {
  return `${prose}

\`\`\`json path=manifest.json
${MANIFEST}
\`\`\`

\`\`\`html path=index.html
${INDEX_HTML}
\`\`\`

\`\`\`js path=widget.js
${widgetJs(showPercent)}
\`\`\``;
}

/**
 * One reply per turn, in order.
 *
 * `wizardFixture` walks this list and repeats the last entry once it runs out,
 * because a demo that answers twice and then goes silent reads as broken while
 * one that plainly repeats reads as a recording.
 */
export const DEMO_REPLIES = [
  reply("Here’s your tracker.", false),
  reply("Added the percentage next to the value.", true),
];

/**
 * How to tell the finished widget from the half-finished one.
 *
 * The page-level tour has to know when the *second* turn has landed, and the
 * only honest signal is the file the Wizard wrote. Naming the marker here
 * keeps that coupling in one place instead of a string literal in the tour:
 * the demo waited for the first draft instead, which turn one already writes,
 * and closed the Wizard mid-conversation.
 */
export const DEMO_FINAL_MARKER = "SHOW_PERCENT = true";
