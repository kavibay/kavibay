/**
 * The theme hand-off moved to `@sdk/contract/sandbox-guest`, because `applyTheme`
 * runs inside a package and cannot be GPL, and splitting the pair would leave
 * the token list — the actual contract — on the wrong side of the licence line
 * from the code that consumes it.
 *
 * This file stays as the host's import point so call sites read the same as the
 * rest of the extension host. It is a pointer, not a copy.
 */
export {
  SANDBOX_THEME_TOKENS, applyTheme, readTheme, type SandboxTheme,
} from "@sdk/contract/sandbox-guest";
