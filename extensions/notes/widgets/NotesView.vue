<script setup lang="ts">
import {
  computed,
  inject,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
  type ComputedRef,
} from "vue";
import { EditorContent, useEditor } from "@tiptap/vue-3";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Markdown } from "@tiptap/markdown";
import { WIDGET_FOCUS_EVENT, widgetFocusRequestMatches, type WidgetSurface } from "@sdk";
import {
  isValidNoteUrl,
  plainTextWithBreaksToHtml,
  shouldPreferPlainTextLineBreaks,
} from "../notesLogic";
import type { NotesModel } from "./notes";

const props = defineProps<{ model: NotesModel }>();

const injectedInstanceId = inject<string>("widgetInstanceId");
if (!injectedInstanceId) throw new Error("widgetInstanceId missing");
const instanceId: string = injectedInstanceId;
const widgetSurface = inject<WidgetSurface>("widgetSurface", "desk");
const hostSized = inject<ComputedRef<boolean>>("widgetHostSized", computed(() => false));
const contentScale = inject<ComputedRef<number>>("widgetContentScale", computed(() => 1));

const linkOpen = ref(false);
const linkDraft = ref("");
const linkError = ref<string | null>(null);
const linkInput = ref<HTMLInputElement | null>(null);

watch(
  () => props.model.state.value.toolbarVisible,
  (visible) => {
    if (!visible) {
      linkOpen.value = false;
      linkError.value = null;
    }
  },
);

const rootStyle = computed(() =>
  hostSized.value
    ? { width: "100%", height: "100%" }
    : {
        width: `${props.model.state.value.width}px`,
        height: `${props.model.state.value.height}px`,
      },
);

const formattingStyle = computed(() => ({ zoom: String(1 / contentScale.value) }));

const editor = useEditor({
  extensions: [
    StarterKit.configure({
      heading: { levels: [1, 2] },
      link: false,
      underline: false,
    }),
    Underline,
    Link.configure({
      openOnClick: false,
      autolink: true,
      defaultProtocol: "https",
      protocols: ["http", "https"],
      isAllowedUri: (url) => isValidNoteUrl(url),
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    // The markdown shortcuts already work while typing; the empty note is where people learn them.
    Placeholder.configure({ placeholder: "Write a note…  “- ” list · “[ ] ” checklist · “# ” heading" }),
    Markdown,
  ],
  content: props.model.state.value.markdown || "",
  contentType: "markdown",
  editorProps: {
    attributes: { class: "notes-prose", "data-interactive": "true" },
    // A click on a link opens it in the browser. Only a plain click: a drag that
    // ends on a link is a selection, and the caret can still reach link text by keyboard.
    handleClick(view, _pos, event) {
      const anchor = (event.target as HTMLElement | null)?.closest?.("a[href]");
      if (!anchor || event.button !== 0 || !view.state.selection.empty) return false;
      event.preventDefault();
      // The host opens https only; a failed open leaves the note as it was.
      props.model.openUrl(anchor.getAttribute("href") ?? "").catch(() => undefined);
      return true;
    },
    handlePaste(_view, event) {
      const plain = event.clipboardData?.getData("text/plain") ?? "";
      const html = event.clipboardData?.getData("text/html") ?? "";
      if (!shouldPreferPlainTextLineBreaks(plain, html)) return false;
      const ed = editor.value;
      if (!ed) return false;
      ed.chain().focus().insertContent(plainTextWithBreaksToHtml(plain)).run();
      return true;
    },
  },
  onUpdate: ({ editor: ed }) => {
    props.model.setMarkdown(ed.getMarkdown());
  },
});

const chain = () => editor.value?.chain().focus();

/**
 * One list for the toolbar and the right-click menu, so the two never drift.
 * Tips name Tiptap's default shortcuts (Windows, hence Ctrl).
 */
const formatButtons: { label: string; cls?: string; tip: string; active: () => boolean | undefined; run: () => void }[] = [
  { label: "B", tip: "Bold (Ctrl+B)", active: () => editor.value?.isActive("bold"), run: () => chain()?.toggleBold().run() },
  { label: "I", cls: "i", tip: "Italic (Ctrl+I)", active: () => editor.value?.isActive("italic"), run: () => chain()?.toggleItalic().run() },
  { label: "U", cls: "u", tip: "Underline (Ctrl+U)", active: () => editor.value?.isActive("underline"), run: () => chain()?.toggleUnderline().run() },
  { label: "S", cls: "s", tip: "Strikethrough (Ctrl+Shift+S)", active: () => editor.value?.isActive("strike"), run: () => chain()?.toggleStrike().run() },
  { label: "H1", tip: "Heading 1 (Ctrl+Alt+1)", active: () => editor.value?.isActive("heading", { level: 1 }), run: () => chain()?.toggleHeading({ level: 1 }).run() },
  { label: "H2", tip: "Heading 2 (Ctrl+Alt+2)", active: () => editor.value?.isActive("heading", { level: 2 }), run: () => chain()?.toggleHeading({ level: 2 }).run() },
  { label: "•", tip: "Bullet list (Ctrl+Shift+8)", active: () => editor.value?.isActive("bulletList"), run: () => chain()?.toggleBulletList().run() },
  { label: "1.", tip: "Numbered list (Ctrl+Shift+7)", active: () => editor.value?.isActive("orderedList"), run: () => chain()?.toggleOrderedList().run() },
  { label: "☑", tip: "Checklist (Ctrl+Shift+9)", active: () => editor.value?.isActive("taskList"), run: () => chain()?.toggleTaskList().run() },
  { label: "Link", tip: "Link", active: () => editor.value?.isActive("link"), run: openLink },
];

/** Right-click on a selection: formatting menu at the cursor, toolbar or not. */
const selectionMenu = ref<{ x: number; y: number } | null>(null);

function onEditorContextMenu(event: MouseEvent) {
  if (!editor.value || editor.value.state.selection.empty) return;
  // Preventing the default tells WidgetCard our menu wins over the widget menu.
  event.preventDefault();
  // Viewport coords + Teleport to body, like the launcher's icon menu, so the
  // card's transform and overflow cannot clip or offset it.
  selectionMenu.value = { x: event.clientX, y: event.clientY };
}

function fromMenu(action: () => void) {
  action();
  selectionMenu.value = null;
}

function onDocPointerDown(event: PointerEvent) {
  if (!(event.target as HTMLElement | null)?.closest?.(".notes-selection-menu")) selectionMenu.value = null;
}

function onDocKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") selectionMenu.value = null;
}

watch(selectionMenu, (open) => {
  if (open) {
    document.addEventListener("pointerdown", onDocPointerDown, true);
    document.addEventListener("keydown", onDocKeydown, true);
  } else {
    document.removeEventListener("pointerdown", onDocPointerDown, true);
    document.removeEventListener("keydown", onDocKeydown, true);
  }
});

function openLink() {
  const href = editor.value?.getAttributes("link").href;
  linkDraft.value = typeof href === "string" ? href : "";
  linkError.value = null;
  linkOpen.value = true;
  void nextTick(() => linkInput.value?.focus());
}

function applyLink() {
  const url = linkDraft.value.trim();
  if (!isValidNoteUrl(url)) {
    linkError.value = "http(s) URL required";
    return;
  }
  editor.value?.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  linkOpen.value = false;
  linkError.value = null;
}

function removeLink() {
  editor.value?.chain().focus().extendMarkRange("link").unsetLink().run();
  linkOpen.value = false;
  linkError.value = null;
}

function focusEditor(attemptsLeft = 4) {
  if (editor.value) {
    editor.value.commands.focus("end");
    return;
  }
  if (attemptsLeft > 0) {
    window.setTimeout(() => focusEditor(attemptsLeft - 1), 50);
  }
}

function onEditorPointerDown(event: PointerEvent) {
  event.stopPropagation();
  const target = event.target as HTMLElement | null;
  if (target?.closest(".ProseMirror")) return;
  focusEditor();
}

function onKavibayFocusWidget(event: Event) {
  if (!widgetFocusRequestMatches(event, instanceId, widgetSurface)) return;
  focusEditor();
}

onMounted(() => {
  void nextTick();
  window.addEventListener(WIDGET_FOCUS_EVENT, onKavibayFocusWidget);
});

onBeforeUnmount(() => {
  window.removeEventListener(WIDGET_FOCUS_EVENT, onKavibayFocusWidget);
  document.removeEventListener("pointerdown", onDocPointerDown, true);
  document.removeEventListener("keydown", onDocKeydown, true);
  void props.model.flush();
  editor.value?.destroy();
});
</script>

<template>
  <div class="notes-widget" :style="rootStyle" data-interactive>
    <!-- The link input also opens from the right-click menu, so it does not need the toolbar. -->
    <div v-if="model.state.value.toolbarVisible || linkOpen" class="notes-formatting" :style="formattingStyle">
      <div v-if="model.state.value.toolbarVisible" class="notes-toolbar" @pointerdown.stop>
        <button v-for="b in formatButtons" :key="b.tip" type="button" class="notes-btn" :class="{ active: b.active() }" v-tip="b.tip" @click="b.run"><span :class="b.cls">{{ b.label }}</span></button>
      </div>

    <div v-if="linkOpen" class="notes-link-pop" data-interactive @pointerdown.stop>
        <input ref="linkInput" v-model="linkDraft" class="notes-link-input" type="url" placeholder="https://…" aria-label="Link URL" @keydown.enter.prevent="applyLink" />
        <p v-if="linkError" class="notes-link-error">{{ linkError }}</p>
        <div class="notes-link-actions">
          <button type="button" class="notes-btn" @click="applyLink">OK</button>
          <button type="button" class="notes-btn" @click="removeLink">Remove</button>
          <button type="button" class="notes-btn" @click="linkOpen = false">Cancel</button>
        </div>
      </div>
    </div>

    <div class="notes-editor" @pointerdown="onEditorPointerDown" @contextmenu="onEditorContextMenu">
      <EditorContent :editor="editor" />
    </div>

    <Teleport to="body">
      <!-- mousedown.prevent keeps the editor's selection while a button is clicked. -->
      <div
        v-if="selectionMenu"
        class="notes-selection-menu"
        data-interactive
        :style="{ left: selectionMenu.x + 'px', top: selectionMenu.y + 'px' }"
        @mousedown.prevent
        @contextmenu.prevent
      >
        <button v-for="b in formatButtons" :key="b.tip" type="button" class="notes-btn" :class="{ active: b.active() }" v-tip="b.tip" @click="fromMenu(b.run)"><span :class="b.cls">{{ b.label }}</span></button>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.notes-widget { position: relative; display: flex; flex-direction: column; flex: 1 1 auto; width: 100%; min-width: 0; min-height: 0; box-sizing: border-box; cursor: text; }
.notes-toolbar { display: flex; flex-wrap: wrap; gap: 4px; padding-bottom: 6px; border-bottom: 1px solid rgba(var(--fg-rgb), 0.08); margin-bottom: 6px; flex-shrink: 0; }
.notes-btn { appearance: none; border: 0; background: rgba(var(--fg-rgb), 0.06); color: rgba(var(--fg-rgb), 0.85); font: inherit; font-size: 12px; line-height: 1; padding: 5px 7px; border-radius: 6px; cursor: pointer; }
.notes-btn:hover { background: rgba(var(--fg-rgb), 0.12); }
.notes-btn.active { background: rgba(var(--fg-rgb), 0.18); color: #fff; }
.notes-btn .i { font-style: italic; }
.notes-btn .u { text-decoration: underline; }
.notes-btn .s { text-decoration: line-through; }
.notes-selection-menu { position: fixed; z-index: 50; display: flex; gap: 4px; padding: 4px; border-radius: 8px; background: rgba(24, 24, 28, 0.96); border: 1px solid rgba(var(--fg-rgb), 0.12); box-shadow: 0 8px 20px rgba(var(--shadow-rgb), calc(0.4 * var(--surface-shadow, 1) * var(--shadow-scale, 1))); }
.notes-link-pop { display: flex; flex-direction: column; gap: 6px; padding: 8px; margin-bottom: 6px; background: rgba(0, 0, 0, 0.35); border-radius: 8px; flex-shrink: 0; }
.notes-link-input { width: 100%; box-sizing: border-box; border: 1px solid rgba(var(--fg-rgb), 0.12); background: rgba(0, 0, 0, 0.25); color: #fff; border-radius: 6px; padding: 6px 8px; font: inherit; font-size: 12px; }
.notes-link-error { margin: 0; font-size: 11px; color: #f0a0a0; }
.notes-link-actions { display: flex; gap: 4px; }
.notes-editor { flex: 1; min-height: 0; overflow: auto; padding: 0 10px; }
.notes-editor :deep(.notes-prose) { outline: none; font-size: 13px; line-height: 1.45; color: rgba(var(--fg-rgb), 0.92); }
.notes-editor :deep(.notes-prose p.is-editor-empty:first-child::before) { content: attr(data-placeholder); color: rgba(var(--fg-rgb), 0.35); float: left; height: 0; pointer-events: none; }
.notes-editor :deep(.notes-prose h1) { font-size: 1.35em; margin: 0.4em 0 0.25em; }
.notes-editor :deep(.notes-prose h2) { font-size: 1.15em; margin: 0.35em 0 0.2em; }
.notes-editor :deep(.notes-prose ul), .notes-editor :deep(.notes-prose ol) { padding-left: 1.25em; margin: 0.35em 0; }
/* Tiptap wraps every list item in a <p>; without this its default margin spaces items apart. */
.notes-editor :deep(.notes-prose li p) { margin: 0; }
.notes-editor :deep(.notes-prose ul[data-type="taskList"]) { list-style: none; padding-left: 0.1em; }
.notes-editor :deep(.notes-prose ul[data-type="taskList"] li) { display: flex; gap: 6px; align-items: flex-start; }
.notes-editor :deep(.notes-prose ul[data-type="taskList"] li > label) { flex-shrink: 0; user-select: none; }
.notes-editor :deep(.notes-prose ul[data-type="taskList"] input) { margin: 0.25em 0 0; accent-color: rgba(var(--fg-rgb), 0.8); cursor: pointer; }
.notes-editor :deep(.notes-prose ul[data-type="taskList"] li > div) { flex: 1; min-width: 0; }
.notes-editor :deep(.notes-prose li[data-checked="true"] > div) { opacity: 0.5; text-decoration: line-through; }
.notes-editor :deep(.notes-prose a) { color: #9ecbff; text-decoration: underline; cursor: pointer; }
</style>
