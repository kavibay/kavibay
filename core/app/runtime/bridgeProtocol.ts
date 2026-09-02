/**
 * postMessage protocol between host and sandboxed runtime extension iframes.
 * Storage and HTTP are always host-mediated via frame identity (never trust
 * payload ids).
 */

import {
  loadRuntimeInstanceJson,
  saveRuntimeInstanceJson,
} from "./runtimeStorage";

export type ExtToHost =
  | { type: "kavibay.ext.ready"; extId: string }
  | {
      type: "kavibay.ext.storage.get";
      requestId: string;
      /** Ignored by the host; kept so older packages still type-check. */
      extId?: string;
      instanceId?: string;
    }
  | {
      type: "kavibay.ext.storage.set";
      requestId: string;
      extId?: string;
      instanceId?: string;
      value: unknown;
    }
  | {
      type: "kavibay.ext.http.call";
      requestId: string;
      /** Endpoint id from the package's own api.json. */
      endpointId: string;
      args: unknown;
    }
  /**
   * Something threw inside the frame. No `requestId`: nothing is being asked
   * for and nothing is sent back, which is also why this one grants nothing
   * and is safe to accept from code that is by definition misbehaving.
   *
   * The payload matches `GuestFault` in the contract SDK, because the two
   * package formats show up in the same debug panel and a panel that had to
   * branch on which kind of package it was reading would be the wrong shape.
   */
  | {
      type: "kavibay.ext.fault";
      source: "error" | "rejection" | "console";
      message: string;
      where?: string;
      stack?: string;
    }
  /**
   * How tall the package's own content is, measured inside the frame.
   *
   * The host cannot measure it: the frame is sandboxed to an opaque origin and
   * its layout is not readable from here. Only the guest can say, so it says.
   *
   * Like a fault, this carries no `requestId` and grants nothing — it is a
   * number used to size a card, and a package lying about it can make its own
   * card the wrong size, which it could already do through `ui.defaultSize`.
   */
  | { type: "kavibay.ext.content-size"; width: number; height: number };

/** Stable failure codes a package can branch on (design §7). */
export type HttpErrorCode =
  | "permission_denied"
  /** The declaration changed after consent; the user has to review it again. */
  | "consent_stale"
  | "unknown_endpoint"
  | "invalid_arguments"
  | "rate_limited"
  | "budget_exhausted"
  | "blocked_address"
  | "http_error"
  | "network_error"
  | "timeout"
  | "too_large"
  /** The package was never granted this credential type. */
  | "credential_not_granted"
  /** The credential exists in the registry but the user has not set it up. */
  | "credential_not_configured"
  /** Its tokens were rejected; the user has to reconnect the account. */
  | "credential_needs_reauth"
  | "credential_error";

/** Backend result of one declared endpoint call. */
export interface HttpCallResult {
  ok: boolean;
  status: number | null;
  data: unknown;
  code: string | null;
  detail: string | null;
  retryAfterSecs: number | null;
  fromCache: boolean;
}

export type HostToExt =
  | { type: "kavibay.ext.storage.result"; requestId: string; ok: true; value: unknown }
  | { type: "kavibay.ext.storage.result"; requestId: string; ok: false; error: string }
  | { type: "kavibay.ext.http.result"; requestId: string; result: HttpCallResult };

/** Host-bound frame identity; payload extId/instanceId must never override these. */
export interface BridgeFrameIdentity {
  extId: string;
  instanceId: string;
  grantedPermissions: readonly string[];
}

const STORAGE_PERM = "storage.instance";
export const NETWORK_DECLARED_PERM = "network.declared";

/** Narrow unknown postMessage data to ExtToHost. */
export function isExtToHost(data: unknown): data is ExtToHost {
  if (!data || typeof data !== "object") return false;
  const o = data as Record<string, unknown>;
  if (typeof o.type !== "string") return false;
  switch (o.type) {
    case "kavibay.ext.ready":
      return typeof o.extId === "string";
    // Payload extId/instanceId are ignored in favour of frame identity, so
    // they are not required either: demanding them would only make the SDK
    // send decoration that the host throws away.
    case "kavibay.ext.storage.get":
      return typeof o.requestId === "string";
    case "kavibay.ext.storage.set":
      return typeof o.requestId === "string" && "value" in o;
    case "kavibay.ext.http.call":
      return typeof o.requestId === "string" && typeof o.endpointId === "string";
    // Only the message is required. A guest that reported a fault without one
    // has nothing to show, and `source` is normalised rather than demanded —
    // dropping a real crash because its label was unexpected would lose the
    // one message that mattered.
    case "kavibay.ext.fault":
      return typeof o.message === "string";
    default:
      return false;
  }
}

/** The three known labels; anything else is read as an uncaught throw. */
export function faultSourceOf(value: unknown): "error" | "rejection" | "console" {
  return value === "rejection" || value === "console" ? value : "error";
}

/** True when frame was granted storage.instance. */
function hasStoragePermission(identity: BridgeFrameIdentity): boolean {
  return identity.grantedPermissions.includes(STORAGE_PERM);
}

/** Build a storage error reply. */
function storageError(requestId: string, error: string): HostToExt {
  return { type: "kavibay.ext.storage.result", requestId, ok: false, error };
}

/** Build an http failure reply without going near the backend. */
export function httpFailure(requestId: string, code: HttpErrorCode): HostToExt {
  return {
    type: "kavibay.ext.http.result",
    requestId,
    result: {
      ok: false,
      status: null,
      data: null,
      code,
      detail: null,
      retryAfterSecs: null,
      fromCache: false,
    },
  };
}

/**
 * Handle one synchronous ExtToHost message using frame identity (ignore payload
 * extId/instanceId). Returns null when no reply is needed (e.g. ready).
 *
 * `kavibay.ext.http.call` is deliberately **not** handled here: it needs an
 * await and the backend, so the frame component routes it separately.
 */
export function handleBridgeMessage(
  msg: ExtToHost,
  identity: BridgeFrameIdentity,
  storage?: Storage,
): HostToExt | null {
  switch (msg.type) {
    case "kavibay.ext.ready":
      return null;

    case "kavibay.ext.http.call":
      // Answered asynchronously by the frame; see `RuntimeExtensionFrame.vue`.
      return null;

    case "kavibay.ext.fault":
      // Reported, never answered. The frame logs it; there is nothing to send
      // back and nothing here that a fault should be able to reach.
      return null;

    case "kavibay.ext.content-size":
      // Same shape: the frame turns it into a card size and there is nothing to
      // reply with. Listed rather than defaulted so the switch stays exhaustive
      // — that is what makes the next message a compile error instead of a
      // silent drop.
      return null;

    case "kavibay.ext.storage.get": {
      if (!hasStoragePermission(identity)) {
        return storageError(msg.requestId, "permission denied: storage.instance");
      }
      const value = loadRuntimeInstanceJson(
        identity.extId,
        identity.instanceId,
        storage,
      );
      return {
        type: "kavibay.ext.storage.result",
        requestId: msg.requestId,
        ok: true,
        value,
      };
    }

    case "kavibay.ext.storage.set": {
      if (!hasStoragePermission(identity)) {
        return storageError(msg.requestId, "permission denied: storage.instance");
      }
      try {
        saveRuntimeInstanceJson(
          identity.extId,
          identity.instanceId,
          msg.value,
          storage,
        );
        return {
          type: "kavibay.ext.storage.result",
          requestId: msg.requestId,
          ok: true,
          value: msg.value,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return storageError(msg.requestId, message);
      }
    }
  }
}
