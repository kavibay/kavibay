// SPDX-License-Identifier: MIT
import {
  MCP_DEFAULT_PORT,
  MCP_HOST,
  MCP_PATH,
  MCP_TOKEN_ENV_VAR,
  MCP_TOKEN_PLACEHOLDER,
  buildClaudeCodeCommand,
  buildCodexCommand,
  buildCodexConfigSnippet,
  buildMcpUrl,
  isValidMcpPort,
  mcpStatusPresentation,
  parseMcpPort,
  parseMcpUrlPort,
} from "./mcpServerLogic";

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal(actual: unknown, expected: unknown, message: string): void {
  check(Object.is(actual, expected), `${message}: ${String(actual)} !== ${String(expected)}`);
}

function deepEqual(actual: unknown, expected: unknown, message: string): void {
  equal(JSON.stringify(actual), JSON.stringify(expected), message);
}

equal(parseMcpPort("43127"), MCP_DEFAULT_PORT, "valid port parses");
equal(parseMcpPort(" 45000 "), 45000, "surrounding whitespace is harmless");
equal(parseMcpPort("1023"), null, "privileged ports are rejected");
equal(parseMcpPort("43127.5"), null, "decimal ports are rejected");
equal(parseMcpPort(""), null, "empty ports are rejected");
equal(parseMcpPort(65_535), 65_535, "highest valid port parses");
equal(isValidMcpPort(1024), true, "lower bound is inclusive");
equal(isValidMcpPort(65_536), false, "values above u16 are rejected");

deepEqual(mcpStatusPresentation("stopped", false), {
  label: "Disabled",
  tone: "neutral",
}, "stopped status maps to disabled");
deepEqual(mcpStatusPresentation("starting", true), {
  label: "Starting…",
  tone: "warning",
}, "starting status maps to warning");
deepEqual(mcpStatusPresentation("running", true), {
  label: "Running",
  tone: "success",
}, "running status maps to success");
deepEqual(mcpStatusPresentation("error", true), {
  label: "Error",
  tone: "danger",
}, "error status maps to danger");

const port = 45_678;
const url = buildMcpUrl(port);
const snippet = buildCodexConfigSnippet(port);
equal(url, `http://${MCP_HOST}:${port}${MCP_PATH}`, "URL is fixed to loopback /mcp");
equal(parseMcpUrlPort(url), port, "running URL exposes its selected port");
check(new RegExp(`127\\.0\\.0\\.1:${port}\\/mcp`).test(snippet), "snippet uses selected URL");
check(snippet.includes("[mcp_servers.kavibay]"), "Codex table is present");
check(!/[A-Za-z]:\\\\|\/Users\/|\/home\//i.test(snippet), "no filesystem path");
check(!/token|secret|password|api[_-]?key/i.test(snippet), "no secret material");

const withToken = buildCodexConfigSnippet(port, true);
check(
  withToken.endsWith(`\nbearer_token_env_var = "${MCP_TOKEN_ENV_VAR}"`),
  "a required token is read from the environment",
);
check(!/kvb_/.test(withToken), "the token itself never lands in the config file");

equal(buildClaudeCodeCommand(url), `claude mcp add --transport http kavibay ${url}`, "Claude Code, open server");
equal(
  buildClaudeCodeCommand(url, true),
  `claude mcp add --transport http kavibay ${url} --header "Authorization: Bearer ${MCP_TOKEN_PLACEHOLDER}"`,
  "Claude Code, token not on screen",
);
check(
  buildClaudeCodeCommand(url, true, "kvb_abc").endsWith(`"Authorization: Bearer kvb_abc"`),
  "Claude Code carries a freshly shown token",
);
equal(buildCodexCommand(url), `codex mcp add kavibay --url ${url}`, "Codex, open server");
equal(
  buildCodexCommand(url, true),
  `codex mcp add kavibay --url ${url} --bearer-token-env-var ${MCP_TOKEN_ENV_VAR}`,
  "Codex reads the token from the environment",
);

console.log("mcpServerLogic assertions passed");
