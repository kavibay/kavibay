// SPDX-License-Identifier: MIT
import { onBeforeUnmount, type Directive } from "vue";

/**
 * Play tile intro videos only while they are actually on screen.
 *
 * Without this every tile decodes its own `intro.mp4` the moment the gallery
 * opens (WebView2 runs with `autoplay-policy=no-user-gesture-required`), so a
 * dozen decoders and their frame buffers stay resident for a card where at most
 * a few tiles are visible. Attaching `src` on enter and dropping it on exit
 * keeps that cost proportional to what the user can see.
 */

/** Start slightly before a tile scrolls in so it is playing when it lands. */
const ROOT_MARGIN = "120px 0px";

/** Attach the source and start playback (idempotent). */
function attach(el: HTMLVideoElement): void {
  const url = el.dataset.introSrc;
  if (!url || el.getAttribute("src") === url) return;
  el.src = url;
  void el.play().catch(() => {
    // Autoplay can still be refused (e.g. policy change) — a static first
    // frame is an acceptable fallback, so swallow instead of logging per tile.
  });
}

/**
 * Pause and release the source.
 * `load()` after removing `src` is what actually frees the decoder and buffered
 * frames; pausing alone leaves both alive.
 */
function detach(el: HTMLVideoElement): void {
  if (!el.hasAttribute("src")) return;
  el.pause();
  el.removeAttribute("src");
  el.load();
}

/**
 * Returns a directive for `<video>` tiles. Put the URL in `data-intro-src`
 * (not `src`) so nothing loads until the tile is seen.
 */
export function useLazyIntroVideos(): { vLazyIntro: Directive<HTMLVideoElement> } {
  const observed = new Set<HTMLVideoElement>();

  // Created eagerly rather than in onMounted: directive `mounted` hooks on
  // child elements run before the parent component's onMounted.
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const el = entry.target as HTMLVideoElement;
        if (entry.isIntersecting) attach(el);
        else detach(el);
      }
    },
    { rootMargin: ROOT_MARGIN, threshold: 0 },
  );

  onBeforeUnmount(() => {
    observer.disconnect();
    for (const el of observed) detach(el);
    observed.clear();
  });

  const vLazyIntro: Directive<HTMLVideoElement> = {
    mounted(el) {
      observed.add(el);
      observer.observe(el);
    },
    unmounted(el) {
      observed.delete(el);
      observer.unobserve(el);
      detach(el);
    },
  };

  return { vLazyIntro };
}
