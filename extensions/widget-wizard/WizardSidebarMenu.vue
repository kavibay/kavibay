<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, type CSSProperties } from "vue";
import { CirclePlayIcon, MessageSquareIcon, Trash2Icon } from "@sdk/icons";

const props = defineProps<{ x: number; y: number; canRun: boolean; canCreate: boolean; busy: boolean }>();
const emit = defineEmits<{ run: []; create: []; delete: []; close: [restoreFocus?: boolean] }>();
const panel = ref<HTMLElement | null>(null);
const position = ref<CSSProperties>({ left: `${props.x}px`, top: `${props.y}px`, visibility: "hidden" });
const confirming = ref(false);

function actions() {
  return Array.from(panel.value?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
}
function onKey(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    emit("close", true);
  } else if (panel.value?.contains(event.target as Node) && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
    event.preventDefault();
    const buttons = actions();
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
      : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  } else if (event.key === "Tab") emit("close");
}
function onOutside(event: PointerEvent) {
  if (!panel.value?.contains(event.target as Node)) emit("close");
}
function dismiss() { emit("close"); }
onMounted(async () => {
  await nextTick();
  if (!panel.value) return;
  position.value = {
    left: `${Math.max(8, Math.min(props.x, window.innerWidth - panel.value.offsetWidth - 8))}px`,
    top: `${Math.max(8, Math.min(props.y, window.innerHeight - panel.value.offsetHeight - 8))}px`,
    visibility: "visible",
  };
  actions()[0]?.focus();
  window.addEventListener("pointerdown", onOutside, true);
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("resize", dismiss);
  window.addEventListener("scroll", dismiss, true);
});
onUnmounted(() => {
  window.removeEventListener("pointerdown", onOutside, true);
  window.removeEventListener("keydown", onKey, true);
  window.removeEventListener("resize", dismiss);
  window.removeEventListener("scroll", dismiss, true);
});
</script>

<template>
  <Teleport to="body">
    <div ref="panel" class="sidebar-menu" :style="position" role="menu" aria-label="Sidebar actions" @contextmenu.stop.prevent>
      <button type="button" role="menuitem" :disabled="busy || !canRun" @click="emit('run')">
        <CirclePlayIcon :size="16" /> Run on desk
      </button>
      <button v-if="canCreate" type="button" role="menuitem" :disabled="busy" @click="emit('create')">
        <MessageSquareIcon :size="16" /> New conversation
      </button>
      <div class="sidebar-menu__separator" role="separator" />
      <button type="button" role="menuitem" class="sidebar-menu__delete" :disabled="busy"
        @click="confirming ? emit('delete') : confirming = true">
        <Trash2Icon :size="16" /> {{ confirming ? 'Confirm deletion' : 'Delete' }}
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.sidebar-menu {
  position: fixed;
  z-index: 10000;
  box-sizing: border-box;
  width: min(220px, calc(100vw - 16px));
  padding: 5px;
  border: 1px solid rgba(var(--fg-rgb), .14);
  border-radius: 10px;
  background: var(--surface-popup, rgba(27, 28, 31, .98));
  box-shadow: 0 8px 28px rgba(0, 0, 0, .3);
  color: rgb(var(--fg-rgb));
  font-size: 12px;
}
.sidebar-menu button {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 9px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.sidebar-menu button:hover:not(:disabled), .sidebar-menu button:focus-visible { background: rgba(var(--fg-rgb), .08); }
.sidebar-menu button:focus-visible { outline: 1px solid rgba(var(--fg-rgb), .25); outline-offset: -1px; }
.sidebar-menu button:disabled { opacity: .35; cursor: default; }
.sidebar-menu .sidebar-menu__delete { color: #dc947d; }
.sidebar-menu__separator { height: 1px; margin: 4px; background: rgba(var(--fg-rgb), .1); }
</style>
