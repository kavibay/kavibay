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
