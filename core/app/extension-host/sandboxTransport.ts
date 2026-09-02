import { eventMessage, isRequest, responseMessage } from "@sdk/contract/sandbox-guest";
import type { BridgeConnection } from "./bridge";

/**
 * The host end of the postMessage transport.
 *
 * The guest half, and every message shape both halves use, moved to
 * `@sdk/contract/sandbox-guest`: that code runs inside a package, and a runtime
 * shipped into somebody else's package cannot be GPL. What is left here is the
 * part that must stay on this side — it holds a `BridgeConnection`, which is
 * where every decision about what a frame may reach is made.
 *
 * Payloads stay strings rather than becoming objects. The claim the suite makes
 * about this boundary is that it is genuinely serializable, and a structured
 * clone would quietly carry things JSON cannot, making the claim untestable
 * exactly where it matters.
 */

/**
 * Re-exported so the host's own callers have one import for the channel. The
 * definitions live in the SDK; this is not a second copy.
 */
export {
  SandboxGuestPort, applyTheme, failedMessage, faultMessage, initMessage, installFaultReporting,
  isMounted, isReady, mountedMessage, readFailure, readFault, readInit, readTheme, readThemeMessage,
  readyMessage, themeMessage, SANDBOX_THEME_TOKENS,
} from "@sdk/contract/sandbox-guest";

/**
 * Owns one `BridgeConnection` and answers on the channel it was given.
 *
 * It deliberately does not check where a message came from: only the component
 * holding the iframe knows which `contentWindow` is the right one, and a check
 * done here from a value inside the message would be checking the sender's own
 * word. Callers pass messages in only after that comparison —
 * `scripts/extensionHostSandboxGuard.assert.mjs` is what holds them to it.
 */
export class SandboxHostPort {
  private disposed = false;
  private connection: BridgeConnection;

  /**
   * The connection is opened here rather than passed in, because it needs this
   * port's `emit` and this port needs it — a knot that, left to the caller,
   * means a moment where one exists without the other.
   */
  constructor(
    private post: (message: unknown) => void,
    openConnection: (emit: (eventJson: string) => void) => BridgeConnection,
  ) {
    this.connection = openConnection((eventJson) => this.sendEvent(eventJson));
  }

  /** Returns whether the message was one of ours. */
  accept(data: unknown): boolean {
    if (!isRequest(data)) return false;
    if (this.disposed) return true;
    const { id, payload } = data;
    void this.connection.handle(payload).then((responseJson) => {
      if (this.disposed) return;
      this.post(responseMessage(id, responseJson));
    });
    return true;
  }

  private sendEvent(eventJson: string) {
    if (this.disposed) return;
    this.post(eventMessage(eventJson));
  }

  dispose() {
    this.disposed = true;
    this.connection.dispose();
  }
}
