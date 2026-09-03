/**
 * The Linear/GitHub inbox the second landing demo builds.
 *
 * One turn: the visitor asks for a list of things to take care of, naming
 * Linear and GitHub through the Wizard's own mention menu, and the recording
 * answers with a contract package whose preview is still a DOM widget — this
 * page has no provider bridge, so the rows are fixtures, not live queries.
 * The logos and the kinds of work (assigned issues, review requests) are
 * what those two accounts actually hold.
 *
 * The prose is unwrapped on purpose; see wizardScript.ts.
 */
import type { DemoPromptPart, WizardDemoScript } from "./wizardDemoScript";

/** What the visitor types. Mentions are picked from the Integrations menu. */
const PROMPTS: DemoPromptPart[][] = [
  [
    "Create a list using ",
    { mention: "Linear" },
    "and ",
    { mention: "GitHub" },
    "of tasks that should be taken care of",
  ],
];

/**
 * How to tell this package from the water tracker in the same in-memory store.
 *
 * The tour waits for the *finished* files, and both demos write a draft. A
 * shared marker would let the water tracker trip the inbox wait, or the other
 * way around, if a visitor switched cases mid-run.
 */
export const INBOX_FINAL_MARKER = "INBOX_DEMO_READY";

const MANIFEST = `{
  "name": "inbox",
  "version": "1.0.0",
  "displayName": "Inbox",
  "description": "Linear issues assigned to you, and GitHub review requests.",
  "engines": { "kavibay": "^0.1" },
  "widget": {
    "name": "tile",
    "displayName": "Inbox",
    "defaultSize": { "w": 2, "h": 3 },
    "requires": {
      "providers": ["kavibay.linear/linear", "kavibay.github/github"]
    }
  }
}`;

/**
 * Same mount the water tracker uses, so the embed preview can inline the
 * runtime. A shipping contract package would load `@kavibay/contract.js`;
 * this page has no provider bridge to answer it, and the rows are fixtures.
 */
const INDEX_HTML = `<div id="kavibay-widget"></div>
<style>
  #kavibay-widget {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 2px 2px 0;
    color: rgba(255, 255, 255, 0.92);
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .row {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    padding: 8px 8px 8px 6px;
    border-radius: 10px;
  }
  .row:hover {
    background: rgba(255, 255, 255, 0.06);
  }
  .mark {
    flex: none;
    width: 16px;
    height: 16px;
    margin-top: 2px;
  }
  .mark svg {
    display: block;
    width: 16px;
    height: 16px;
  }
  .body {
    min-width: 0;
    flex: 1;
  }
  .title {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    line-height: 1.3;
  }
  .meta {
    margin: 3px 0 0;
    font-size: 11px;
    color: rgba(255, 255, 255, 0.5);
    line-height: 1.3;
  }
</style>
<script src="@kavibay/runtime.js"></script>
<script src="widget.js"></script>`;

/**
 * Linear's geometric mark and GitHub's octocat, inlined from
 * `sdk/extension/brand/{Linear,GitHub}Mark.vue` so a generated package does
 * not import Vue.
 */
const WIDGET_JS = `const INBOX_DEMO_READY = true;

const LINEAR_MARK = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" aria-hidden="true"><path fill="#5E6AD2" d="M1.225 61.523c-.222-.949.908-1.546 1.597-.857l36.512 36.512c.69.69.092 1.82-.857 1.597-18.425-4.323-32.93-18.827-37.252-37.252ZM.002 46.889a.99.99 0 0 0 .29.76L52.35 99.71c.201.2.478.307.76.29 2.37-.149 4.695-.46 6.963-.927.765-.157 1.03-1.096.478-1.648L2.576 39.448c-.552-.551-1.491-.286-1.648.479a50.067 50.067 0 0 0-.926 6.962ZM4.21 29.705a.988.988 0 0 0 .208 1.1l64.776 64.776c.289.29.726.375 1.1.208a49.908 49.908 0 0 0 5.185-2.684.981.981 0 0 0 .183-1.54L8.436 24.336a.981.981 0 0 0-1.541.183 49.896 49.896 0 0 0-2.684 5.185Zm8.448-11.631a.986.986 0 0 1-.045-1.354C21.78 6.46 35.111 0 49.952 0 77.592 0 100 22.407 100 50.048c0 14.84-6.46 28.172-16.72 37.338a.986.986 0 0 1-1.354-.045L12.659 18.074Z"/></svg>';

const GITHUB_MARK = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" clip-rule="evenodd" d="M8 0C3.58 0 0 3.58 0 8C0 11.54 2.29 14.53 5.47 15.59C5.87 15.66 6.02 15.42 6.02 15.21C6.02 15.02 6.01 14.39 6.01 13.72C4 14.09 3.48 13.23 3.32 12.78C3.23 12.55 2.84 11.84 2.5 11.65C2.22 11.5 1.82 11.13 2.49 11.12C3.12 11.11 3.57 11.7 3.72 11.94C4.44 13.15 5.59 12.81 6.05 12.6C6.12 12.08 6.33 11.73 6.56 11.53C4.78 11.33 2.92 10.64 2.92 7.58C2.92 6.71 3.23 5.99 3.74 5.43C3.66 5.23 3.38 4.41 3.82 3.31C3.82 3.31 4.49 3.1 6.02 4.13C6.66 3.95 7.34 3.86 8.02 3.86C8.7 3.86 9.38 3.95 10.02 4.13C11.55 3.09 12.22 3.31 12.22 3.31C12.66 4.41 12.38 5.23 12.3 5.43C12.81 5.99 13.12 6.7 13.12 7.58C13.12 10.65 11.25 11.33 9.47 11.53C9.76 11.78 10.01 12.26 10.01 13.01C10.01 14.08 10 14.94 10 15.21C10 15.42 10.15 15.67 10.55 15.59C13.71 14.53 16 11.53 16 8C16 3.58 12.42 0 8 0Z"/></svg>';

const ITEMS = [
  { source: "github", title: "feat: Wizard mention chips in the composer", meta: "kavibay/kavibay · review requested" },
  { source: "linear", title: "Palette should rank generated drafts first", meta: "ENG-412 · In Progress" },
  { source: "github", title: "fix: runtime sandbox CSP on generated previews", meta: "kavibay/kavibay · review requested" },
  { source: "linear", title: "Settings: remember the last credentials tab", meta: "ENG-398 · Todo" },
  { source: "linear", title: "Desk: keep mention chips when duplicating a card", meta: "ENG-405 · In Review" },
];

const root = document.getElementById("kavibay-widget");

function markFor(source) {
  const wrap = document.createElement("span");
  wrap.className = "mark";
  wrap.innerHTML = source === "linear" ? LINEAR_MARK : GITHUB_MARK;
  return wrap;
}

function render() {
  root.innerHTML = "";

  const list = document.createElement("div");
  list.className = "list";

  for (const item of ITEMS) {
    const row = document.createElement("div");
    row.className = "row";
    row.appendChild(markFor(item.source));

    const body = document.createElement("div");
    body.className = "body";

    const title = document.createElement("p");
    title.className = "title";
    title.textContent = item.title;
    body.appendChild(title);

    const meta = document.createElement("p");
    meta.className = "meta";
    meta.textContent = item.meta;
    body.appendChild(meta);

    row.appendChild(body);
    list.appendChild(row);
  }

  root.appendChild(list);
}

render();`;

function reply(prose: string): string {
  return `${prose}

\`\`\`json path=manifest.json
${MANIFEST}
\`\`\`

\`\`\`html path=index.html
${INDEX_HTML}
\`\`\`

\`\`\`js path=widget.js
${WIDGET_JS}
\`\`\``;
}

export const INBOX_DEMO: WizardDemoScript = {
  id: "linear-github-todos",
  draftId: "inbox",
  resultRow: "inbox",
  resultQuery: "inbox",
  steps: ["Searching", "Wizard open", "List built", "On the desk"],
  prompts: PROMPTS,
  replies: [
    reply(
      "Here’s your inbox — Linear issues assigned to you, and GitHub pull requests waiting on a review, in one list.",
    ),
  ],
  finalMarker: INBOX_FINAL_MARKER,
};
