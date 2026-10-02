/**
 * A widget that does something: a box that files a Linear issue.
 *
 * The other demos read. This one writes, through the Linear provider's
 * `createIssue` action, which the package declares in its provider entry and
 * the person approves with the account — the host refuses an action that is
 * not both. On the landing page the app answers Linear's GraphQL itself
 * (core/web/webProviders.ts) and keeps created issues for the visit, so the
 * visitor can file one and watch it join the list.
 *
 * The prose is unwrapped on purpose; see wizardScript.ts.
 */
import type { DemoPromptPart, WizardDemoScript } from "./wizardDemoScript";

const PROMPTS: DemoPromptPart[][] = [
  [
    "a quick way to file an issue in ",
    { mention: "Linear" },
    "with the latest ones from the team below it",
  ],
];

/** Only the finished widget has it; see INBOX_FINAL_MARKER. */
export const ISSUE_FINAL_MARKER = "QUICK_ISSUE_READY";

const MANIFEST = `{
  "name": "quick-issue",
  "version": "1.0.0",
  "displayName": "Quick issue",
  "description": "File a Linear issue in one line, and see the team's latest.",
  "engines": { "kavibay": "^0.1" },
  "widget": {
    "name": "tile",
    "displayName": "Quick issue",
    "defaultSize": { "w": 2, "h": 2 },
    "requires": {
      "providers": [
        { "id": "kavibay.linear/linear", "queries": ["teams", "teamIssues"], "actions": ["createIssue"] }
      ]
    }
  }
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
    gap: 8px;
    padding: 0 2px;
    color: rgba(255, 255, 255, 0.92);
  }
  .new-issue {
    display: flex;
    gap: 6px;
  }
  input {
    flex: 1;
    min-width: 0;
    padding: 7px 10px;
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.06);
    color: inherit;
    font: inherit;
    font-size: 12px;
    outline: none;
  }
  input:focus {
    border-color: #5e6ad2;
  }
  button {
    padding: 0 12px;
    border: 0;
    border-radius: 8px;
    background: #5e6ad2;
    color: #fff;
    font: inherit;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.5;
  }
  .status {
    min-height: 14px;
    margin: -2px 0 0;
    font-size: 11px;
    color: rgba(255, 255, 255, 0.5);
  }
  .row {
    display: flex;
    gap: 8px;
    align-items: baseline;
    padding: 3px 2px;
    font-size: 12px;
  }
  .id {
    flex: none;
    color: rgba(255, 255, 255, 0.45);
    font-variant-numeric: tabular-nums;
  }
  .title {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .row.new .id {
    color: #8b93ff;
  }
</style>
</head>
<body>
<div id="kavibay-widget"></div>
<script src="@kavibay/contract.js"></script>
<script src="widget.js"></script>
</body>
</html>`;

const WIDGET_JS = `const ${ISSUE_FINAL_MARKER} = true;
const LINEAR = "kavibay.linear/linear";
const SHOWN = 3;

kavibayWidget.define({
  async setup(ctx) {
    const linear = ctx.providers[LINEAR];
    const [team] = await linear.query("teams", {});
    const latest = async () => (await linear.query("teamIssues", { teamId: team.id })).slice(0, SHOWN);
    return {
      team,
      issues: await latest(),
      latest,
      create: (title) => linear.action("createIssue", { teamId: team.id, title }),
    };
  },

  render(model, root) {
    // Not a <form>: the widget frame is sandboxed without allow-forms, so a
    // submit would never fire. Enter and the button call the same thing.
    const form = document.createElement("div");
    form.className = "new-issue";
    const input = document.createElement("input");
    input.placeholder = "New issue in " + model.team.name + "…";
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Create";
    form.append(input, button);

    const status = document.createElement("p");
    status.className = "status";
    const list = document.createElement("div");

    const show = (issues, fresh) => {
      list.replaceChildren(
        ...issues.map((issue) => {
          const row = document.createElement("div");
          row.className = "row" + (issue.identifier === fresh ? " new" : "");
          const id = document.createElement("span");
          id.className = "id";
          id.textContent = issue.identifier;
          const title = document.createElement("span");
          title.className = "title";
          title.textContent = issue.title;
          row.append(id, title);
          return row;
        }),
      );
    };
    show(model.issues);

    const submit = () => {
      const title = input.value.trim();
      if (!title) return;
      button.disabled = true;
      status.textContent = "Creating…";
      model
        .create(title)
        .then(async (issue) => {
          input.value = "";
          status.textContent = "Created " + issue.identifier;
          show(await model.latest(), issue.identifier);
        })
        .catch(() => {
          status.textContent = "Could not create it. Try again.";
        })
        .finally(() => {
          button.disabled = false;
        });
    };
    button.addEventListener("click", submit);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") submit();
    });

    root.append(form, status, list);
  },
});`;

export const ISSUE_DEMO: WizardDemoScript = {
  id: "linear-quick-issue",
  draftId: "quick-issue",
  resultRow: "quick-issue",
  resultQuery: "quick issue",
  steps: ["Searching", "Wizard open", "Widget built", "On the desk"],
  prompts: PROMPTS,
  replies: [
    `Here’s a quick issue box for Linear: type a title, press Create, and it’s filed in Engineering. The team’s latest three sit below, and a new one shows up there right away.

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
  finalMarker: ISSUE_FINAL_MARKER,
};
