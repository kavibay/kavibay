// SPDX-License-Identifier: MIT
import type { McpServerState, McpServerStatus } from "./mcpServerApi";

export const MCP_DEFAULT_PORT = 43_127;
export const MCP_MIN_PORT = 1_024;
export const MCP_MAX_PORT = 65_535;
export const MCP_HOST = "127.0.0.1";
export const MCP_PATH = "/mcp";
export const MCP_STATUS_POLL_MS = 3_000;

export type McpStatusTone = "neutral" | "success" | "warning" | "danger";

export interface McpStatusPresentation {
  label: string;
  tone: McpStatusTone;
}

/** Parse only an integer port field; empty, decimal and non-numeric input stay invalid. */
export function parseMcpPort(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isInteger(value) && isValidMcpPort(value) ? value : null;
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && isValidMcpPort(parsed) ? parsed : null;
}

/** Loopback ports below 1024 are reserved; MCP uses the full remaining u16 range. */
export function isValidMcpPort(port: number): boolean {
  return Number.isInteger(port) && port >= MCP_MIN_PORT && port <= MCP_MAX_PORT;
}

/** Build the one URL clients are allowed to use. The host and path are intentionally fixed. */
export function buildMcpUrl(port: number): string {
  if (!isValidMcpPort(port)) {
    throw new Error("invalid MCP port");
  }
  return `http://${MCP_HOST}:${port}${MCP_PATH}`;
}

/** Extract a configured loopback port from the backend's running URL. */
export function parseMcpUrlPort(url: string | null): number | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (
      parsed.protocol !== "http:" ||
      parsed.hostname !== MCP_HOST ||
      parsed.pathname !== MCP_PATH ||
      parsed.search ||
      parsed.hash
    ) {
      return null;
    }
    return parseMcpPort(parsed.port);
  } catch {
    return null;
  }
}

/** Keep lifecycle copy independent from the checkbox: the backend is authoritative. */
export function mcpStatusPresentation(
  state: McpServerState,
  desiredEnabled: boolean,
): McpStatusPresentation {
  switch (state) {
    case "starting":
      return { label: "Starting…", tone: "warning" };
    case "running":
      return { label: "Running", tone: "success" };
    case "stopping":
      return { label: "Stopping…", tone: "warning" };
    case "error":
      return { label: "Error", tone: "danger" };
    case "stopped":
    default:
      return desiredEnabled
        ? { label: "Stopped", tone: "warning" }
        : { label: "Disabled", tone: "neutral" };
  }
}

/** Environment variable the Codex snippet reads the bearer token from. */
export const MCP_TOKEN_ENV_VAR = "KAVIBAY_MCP_TOKEN";

/**
 * Current Codex `config.toml` shape for a Streamable HTTP MCP server.
 *
 * With a token, Codex reads it from the environment (`bearer_token_env_var`)
 * rather than from the file, so the snippet can be copied and shared as is.
 */
export function buildCodexConfigSnippet(port: number, tokenRequired = false): string {
  const base = `[mcp_servers.kavibay]\nurl = "${buildMcpUrl(port)}"`;
  return tokenRequired ? `${base}\nbearer_token_env_var = "${MCP_TOKEN_ENV_VAR}"` : base;
}

/** Stands in for the token in a command when the token itself is not on screen. */
export const MCP_TOKEN_PLACEHOLDER = "<your token>";

/**
 * `claude mcp add` for this server.
 *
 * Claude Code stores the header it is given, so a required token goes into the
 * command itself — the real one while it is on screen, a placeholder otherwise.
 */
export function buildClaudeCodeCommand(
  url: string,
  tokenRequired = false,
  token: string | null = null,
): string {
  const base = `claude mcp add --transport http kavibay ${url}`;
  return tokenRequired
    ? `${base} --header "Authorization: Bearer ${token ?? MCP_TOKEN_PLACEHOLDER}"`
    : base;
}

/** `codex mcp add` for this server; Codex reads a required token from the environment. */
export function buildCodexCommand(url: string, tokenRequired = false): string {
  const base = `codex mcp add kavibay --url ${url}`;
  return tokenRequired ? `${base} --bearer-token-env-var ${MCP_TOKEN_ENV_VAR}` : base;
}

/** Convenience helper for consumers that already have a backend status object. */
export function mcpStatusPresentationFor(
  status: Pick<McpServerStatus, "state" | "desiredEnabled">,
): McpStatusPresentation {
  return mcpStatusPresentation(status.state, status.desiredEnabled);
}
