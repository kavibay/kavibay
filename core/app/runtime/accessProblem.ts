import { draftPreviewHost } from "./manifestValidate";

/**
 * What the host tells the person when a declared request is refused for access.
 *
 * A runtime package used to explain these itself, and guessed: a draft never
 * enabled for the network (`permission_denied`) told people to check their
 * Notion account in Settings. The host knows which of three fixes applies, so
 * it says so in the card, outside the frame, the same way a contract widget's
 * connect prompt does. Every other code is the widget's to show.
 */
export type AccessProblem =
  /** Never enabled, or its endpoints changed since the person approved them. */
  | "enable"
  /** No account chosen for this instance, or that account is not granted. */
  | "account"
  /** The account's sign-in was rejected. */
  | "reconnect";

export function accessProblemFor(code: string | null | undefined): AccessProblem | null {
  switch (code) {
    case "permission_denied":
    case "needs_review":
    case "consent_stale":
      return "enable";
    case "credential_not_configured":
    case "credential_not_granted":
      return "account";
    case "credential_needs_reauth":
      return "reconnect";
    default:
      return null;
  }
}

/** The kept package a Wizard preview stands for; the id itself otherwise. */
export function packageIdBehind(extId: string): { id: string; draft: boolean } {
  const prefix = draftPreviewHost("");
  return extId.startsWith(prefix)
    ? { id: extId.slice(prefix.length), draft: true }
    : { id: extId, draft: false };
}
