// SPDX-License-Identifier: MIT
/** Typed adapters for the backend-owned global MCP server setting. */
import { invoke } from "@tauri-apps/api/core";

export type McpServerState =
  | "stopped"
  | "starting"
  | "running"
  | "stopping"
  | "error";

export interface McpServerStatus {
  desiredEnabled: boolean;
  state: McpServerState;
  url: string | null;
  lastError: string | null;
  /** Clients must send `Authorization: Bearer <token>`. The token itself never comes back. */
  tokenRequired: boolean;
}

/** A token change; `token` is set only in the response that generated it. */
export interface McpTokenChange {
  status: McpServerStatus;
  token: string | null;
}

/**
 * Require a freshly generated bearer token, or stop requiring one. The backend
 * keeps only a digest, so the returned token is the one chance to copy it.
 */
export function setMcpServerToken(required: boolean): Promise<McpTokenChange> {
  return invoke<McpTokenChange>("mcp_server_set_token", { required });
}

/** Returns the backend's current lifecycle state; it does not infer state from settings UI. */
export function getMcpServerStatus(): Promise<McpServerStatus> {
  return invoke<McpServerStatus>("mcp_server_status");
}

/** Persists the preference and starts or stops the embedded listener. */
export function setMcpServerEnabled(enabled: boolean): Promise<McpServerStatus> {
  return invoke<McpServerStatus>("mcp_server_set_enabled", { enabled });
}

/** Persists a validated port and restarts the listener when it is running. */
export function setMcpServerPort(port: number): Promise<McpServerStatus> {
  return invoke<McpServerStatus>("mcp_server_set_port", { port });
}

/** Retries a failed bind without changing the user's saved preference. */
export function retryMcpServer(): Promise<McpServerStatus> {
  return invoke<McpServerStatus>("mcp_server_retry");
}
