import { invoke } from "@tauri-apps/api/core";
import { nextTick, onMounted, onUnmounted } from "vue";

// Läuft der Code im echten Tauri-Fenster (nicht als nackter localhost-Tab im Browser)?
// Nur dann existiert die IPC-Brücke zum Rust-Backend.
const hasTauri = () => "__TAURI_INTERNALS__" in window;

/** Mirrors Rust `paused`: while true, rects are unused (window stays interactive). */
let clickThroughPaused = false;

/** Last payload sent to Rust — skip IPC when nothing moved/resized. */
let lastRectsKey = "";

/**
 * Meldet dem Backend die Rechtecke aller interaktiven UI-Elemente. Rust pollt damit die
 * Cursor-Position und schaltet das Fenster außerhalb dieser Rechtecke klick-durchlässig
 * (siehe src-tauri/src/lib.rs). Interaktive Elemente markieren sich per `data-interactive`.
 *
 * No-op while click-through is paused — Rust ignores rects until unpause, so a full DOM
 * scan + IPC on every drag/resize frame only burns main-thread time.
 */
export function syncInteractiveRegions() {
  if (!hasTauri() || clickThroughPaused) return;

  const rects = [...document.querySelectorAll<HTMLElement>("[data-interactive]")].map(
    (el) => {
      const r = el.getBoundingClientRect();
      // CSS-Pixel relativ zur Fenster-Oberkante. Die DPI-/Fensterversatz-Umrechnung
      // macht Rust anhand von scale_factor + outer_position.
      // Round so sub-pixel jitter does not force redundant IPC.
      return {
        x: Math.round(r.left),
        y: Math.round(r.top),
        w: Math.round(r.width),
        h: Math.round(r.height),
      };
    },
  );

  const key = rects.map((r) => `${r.x},${r.y},${r.w},${r.h}`).join("|");
  if (key === lastRectsKey) return;
  lastRectsKey = key;

  void invoke("set_interactive_rects", { rects });
}

/**
 * Pausiert die Click-through-Erkennung. Während eines Drags nötig: sonst könnte der
 * Cursor kurz aus dem Karten-Rechteck geraten, das Fenster würde durchlässig geschaltet
 * und der Webview bekäme keine Pointer-Events mehr — der Drag risse ab.
 */
export function setClickThroughPaused(paused: boolean) {
  clickThroughPaused = paused;
  if (!hasTauri()) return;
  void invoke("set_click_through_paused", { paused });
}

/** Last armed state sent to Rust — the watcher only needs the edges. */
let lastOutsideClickArmed: boolean | undefined;

/**
 * Schaltet die native Außenklick-Erkennung scharf. Rust meldet dann `cockpit:outside-click`,
 * sobald in eine Lücke geklickt wird.
 *
 * Warum nicht im DOM abfangen: ein bildschirmfüllender Fänger müsste sich als interaktives
 * Rechteck melden, damit er den Klick überhaupt sieht — womit das Fenster für das OS
 * undurchlässig wird und der Klick nicht mehr an die App darunter geht. Der erste Klick
 * ginge verloren. Nativ erkannt bleibt die Lücke klick-durchlässig und Windows stellt den
 * Klick regulär zu.
 *
 * Das Argument setzt allerdings voraus, dass die Lücke überhaupt klick-durchlässig *ist*.
 * Wo Click-through gar nicht läuft (natives Wayland), ist nichts mehr zu verlieren — dort
 * übernimmt der DOM-Fänger, siehe {@link needsDomGapCatcher}.
 */
export function setOutsideClickDismiss(armed: boolean) {
  if (!hasTauri() || armed === lastOutsideClickArmed) return;
  lastOutsideClickArmed = armed;
  void invoke("set_outside_click_dismiss", { armed });
}

/**
 * Muss der Außenklick im DOM abgefangen werden, weil Rust ihn auf dieser Plattform nicht
 * melden kann? Die Plattform-Matrix und die Begründung stehen bei `dom_gap_catcher_needed`
 * in `commands.rs` — bewusst dort, damit es genau eine Quelle der Wahrheit gibt.
 *
 * Im Browser (ohne Tauri) gibt es weder Click-through noch Lücken: `false`.
 */
export async function needsDomGapCatcher(): Promise<boolean> {
  if (!hasTauri()) return false;
  return await invoke<boolean>("needs_dom_gap_catcher");
}

// Für hochfrequente Aufrufer (Hover-Chrome, Drag-Ende, Resize): auf einen Frame zusammenfassen,
// damit pointerdown / Textauswahl nicht hinter einem synchronen DOM-Scan warten.
let frame = 0;
export function scheduleRegionSync() {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(syncInteractiveRegions);
}

/**
 * Einmal in der Wurzelkomponente aufrufen. Hält die gemeldeten Rechtecke aktuell, wenn
 * sich das Fenster oder die Größe interaktiver Elemente ändert (z. B. wenn das System-
 * Info-Widget seine Daten lädt oder die Ergebnisliste der Palette wächst).
 */
export function useRegionSync() {
  let observer: ResizeObserver | undefined;
  const onResize = () => scheduleRegionSync();

  onMounted(async () => {
    await nextTick();
    syncInteractiveRegions();
    window.addEventListener("resize", onResize);
    observer = new ResizeObserver(() => scheduleRegionSync());
    document
      .querySelectorAll("[data-interactive]")
      .forEach((el) => observer!.observe(el));
  });

  onUnmounted(() => {
    window.removeEventListener("resize", onResize);
    observer?.disconnect();
  });
}
