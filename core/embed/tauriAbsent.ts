/**
 * What `@tauri-apps/api/*` resolves to inside the embed build.
 *
 * `WidgetCard.vue` is the app's real card, and the app's real card reports its
 * interactive rectangles to Rust (`system/clickThrough.ts`) and reads
 * onboarding state (`onboarding/onboardingSession.ts`). Both already guard
 * every call with a `__TAURI_INTERNALS__` check, so in a browser they are
 * no-ops — but without this alias the bundle would still *carry* about 97 KB
 * of IPC plumbing that can never run, and `scripts/embedImportGuard.assert.mjs`
 * would be right to refuse it.
 *
 * So the alias in `vite.embed.config.ts` points those specifiers here. Every
 * export throws rather than returning a plausible value: the guards mean
 * nothing should reach this file, and if something ever does, a thrown error
 * naming the call is a bug report. A silent stub would instead let a widget
 * quietly behave differently on the web than on the desktop, which is the one
 * thing this whole package exists to prevent.
 */
const absent = (name: string) => (): never => {
  throw new Error(
    `${name} is not available in the browser build; the caller should have checked for Tauri first`,
  );
};

export const invoke = absent("invoke");
export const convertFileSrc = absent("convertFileSrc");
export const listen = absent("listen");
export const emit = absent("emit");
export const once = absent("once");
export const getCurrentWindow = absent("getCurrentWindow");
export const homeDir = absent("homeDir");
export const open = absent("open");

/** A class, because callers `new` it; same contract as the functions above. */
export class Channel {
  onmessage: (message: unknown) => void = () => {};
  constructor() {
    absent("Channel")();
  }
}
