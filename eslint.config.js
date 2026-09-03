// Flat ESLint config. Deliberately small: `vue-tsc` already does the type checking,
// so the rules here are the ones a typechecker cannot see — real mistakes, plus the
// import boundaries that keep the licensing structure in AGENTS.md machine-enforced.
//
// Non-type-aware on purpose. Type-aware linting would roughly double the PR check
// time to re-derive what `npm run typecheck` already knows.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import pluginVue from "eslint-plugin-vue";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "src-tauri/target/**",
      "src-tauri/gen/**",
      // `.claude` holds git worktrees, each a full checkout of this repo. Linted
      // from the main checkout they are a second copy of every source file, and
      // typescript-eslint then refuses everything with "multiple candidate
      // TSConfigRootDirs are present" — 900 parsing errors, none of them about
      // the code. `scripts/runAsserts.mjs` skips this directory for the sibling
      // reason: every assert file would otherwise run once per worktree, and a
      // failure would be reported against a path nobody is editing.
      ".claude/**",
      // Ships to users as-is inside a sandboxed iframe; no build step, no module system.
      "sdk/runtime/kavibay-runtime.js",
      // Build output, not source: `npm run build:guest` emits it from
      // sdk/extension/contract/guest.ts, which is linted. Committed because Rust
      // embeds it at compile time, so a fresh clone must not need npm first.
      "sdk/contract-guest/**",
      // Vendored reference implementation of the extension contract. Not built,
      // not in tsconfig's `include`, and deliberately kept byte-for-byte as
      // received so it stays comparable against the port — reformatting it to
      // this repo's rules would destroy the only thing it is good for.
      "docs/**",
      // Vite's boilerplate shim — `DefineComponent<{}, {}, any>` is upstream's wording.
      "core/app/vite-env.d.ts",
      // Public site plus the embed bundle it loads live outside this repo
      // (`../www.kavibay.com/`). They are not app source.
    ],
  },

  js.configs.recommended,
  tseslint.configs.recommended,
  pluginVue.configs["flat/essential"],

  {
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { parser: tseslint.parser, ecmaVersion: "latest", sourceType: "module" },
    },
    rules: {
      // `_unused` is the established way to mark a deliberately ignored binding.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "no-console": ["warn", { allow: ["warn", "error"] }],
      // Fires on locals that are initialised and then overwritten on every path —
      // a style opinion the typechecker doesn't share. Not worth churning logic for.
      "no-useless-assignment": "off",
    },
  },

  {
    // Assert files are test scaffolding: they print, and they may switch off the
    // typechecker over a large generated fixture. The extension-host fixtures
    // are the same thing under a different name — a harness plus four sample
    // extensions that exist only for `scenarios.assert.ts`.
    files: ["**/*.assert.{ts,mts,mjs}", "core/app/extension-host/fixtures/**"],
    rules: {
      "no-console": "off",
      "@typescript-eslint/ban-ts-comment": "off",
    },
  },

  {
    // The extension contract and its host runtime are a verified reference
    // implementation, ported as-is from docs/extension-sdk-reference/ — the
    // port map calls sdk.ts "the contract", not a draft.
    //
    // Their `any`s are load-bearing rather than lazy. `TConfig` appears both
    // covariantly (`config: Readonly<TConfig>`) and contravariantly
    // (`setup(ctx: WidgetContext<TConfig>)`), so `WidgetDefinition<T>` is
    // invariant: a manifest listing widgets with different config shapes type
    // checks as `WidgetDefinition<any>[]` and cannot be expressed with
    // `unknown`. Narrowing them would change the contract and re-open the
    // findings the suite exists to pin down.
    files: ["sdk/extension/contract/**/*.{ts,vue}", "core/app/extension-host/**/*.{ts,vue}"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },

  // The license boundaries from AGENTS.md are enforced by
  // `scripts/importBoundaries.assert.mjs`, not here: the rule is an *allowlist*
  // ("an extension may import its own folder and packages"), which glob-based
  // no-restricted-imports cannot express without becoming unreadable.

  // --- Node-side files: scripts and build config run outside the browser ---

  {
    files: ["scripts/**", "*.config.{js,ts}", "vite.config.ts", "vite.embed.config.ts", "vite.guest.config.ts"],
    languageOptions: { globals: { ...globals.node } },
    rules: { "no-console": "off" },
  },

  /**
   * A widget package runs inside a sandboxed frame, not in this app: no bundler,
   * no imports, and one global that the host puts there by serving
   * `@kavibay/contract.js` before the package's own script.
   *
   * Declared rather than silenced, so a typo in the name is still an error —
   * which matters, because the symptom of getting it wrong is a package that
   * throws into a console inside a frame nobody has open.
   */
  {
    files: ["sdk/extension/contract/example-package/**/*.js"],
    languageOptions: {
      sourceType: "script",
      globals: { ...globals.browser, kavibayWidget: "readonly" },
    },
  },
);
