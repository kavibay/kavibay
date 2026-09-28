/** A new directory URL also refreshes relative scripts, styles and images. */
export function packageFrameUrl(entryUrl: string, runId: string, wizardPreview = false): string {
  if (!/^[a-zA-Z0-9-]{1,64}$/.test(runId)) throw new Error("Invalid frame run id");
  const url = new URL(entryUrl, typeof window === "undefined" ? undefined : window.location.href);
  // A regular widget must never inherit the inspector opt-in from its entry URL.
  url.searchParams.delete("wizardPreview");
  if (wizardPreview) url.searchParams.set("wizardPreview", "1");
  // Development fixtures live on the app server, which has no package protocol.
  if (url.protocol !== "kavibay-ext:" && url.hostname !== "kavibay-ext.localhost") {
    url.searchParams.set("frameRun", runId);
    return url.href;
  }
  const path = url.pathname.split("/");
  const packageInPath = ["localhost", "kavibay-ext.localhost"].includes(url.hostname);
  path.splice(packageInPath ? 2 : 1, 0, "@run", runId);
  url.pathname = path.join("/");
  return url.href;
}
