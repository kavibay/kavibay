import { onUnmounted, shallowRef, watch, type Ref } from "vue";
import { scheduleRegionSync } from "../system/clickThrough";

/** Shared header band, including the outside controls and their hover bridge. */
export function isCardHeaderHit(clientY: number, cardTop: number): boolean {
  const y = clientY - cardTop;
  return y >= -40 && y <= 40;
}

/** Keep the outside controls reachable when a card touches the screen's top edge. */
export function useCardChromePosition(
  root: Ref<HTMLElement | null>,
  visible: Readonly<Ref<boolean>>,
) {
  const style = shallowRef({ "--card-chrome-top": "-40px" });
  let frame = 0;

  function update() {
    const rect = root.value?.getBoundingClientRect();
    if (rect) {
      const top = `${Math.max(-40, 4 - rect.top)}px`;
      if (style.value["--card-chrome-top"] !== top) {
        style.value = { "--card-chrome-top": top };
        scheduleRegionSync();
      }
    }
    // Card movement is a transform, so ResizeObserver cannot track this edge case.
    frame = requestAnimationFrame(update);
  }

  watch(visible, (show) => {
    cancelAnimationFrame(frame);
    if (show) update();
  }, { immediate: true, flush: "post" });

  onUnmounted(() => cancelAnimationFrame(frame));
  return style;
}
