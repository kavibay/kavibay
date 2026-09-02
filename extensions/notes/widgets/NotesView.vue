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
    Placeholder.configure({ placeholder: "Write a note…" }),
    Markdown,
  ],
  content: props.model.state.value.markdown || "",
  contentType: "markdown",
  editorProps: {
    attributes: { class: "notes-prose", "data-interactive": "true" },
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

function toggleBold() { editor.value?.chain().focus().toggleBold().run(); }
function toggleItalic() { editor.value?.chain().focus().toggleItalic().run(); }
function toggleUnderline() { editor.value?.chain().focus().toggleUnderline().run(); }
function toggleH1() { editor.value?.chain().focus().toggleHeading({ level: 1 }).run(); }
function toggleH2() { editor.value?.chain().focus().toggleHeading({ level: 2 }).run(); }
function toggleBullet() { editor.value?.chain().focus().toggleBulletList().run(); }
function toggleOrdered() { editor.value?.chain().focus().toggleOrderedList().run(); }

function openLink() {
  const href = editor.value?.getAttributes("link").href;
  linkDraft.value = typeof href === "string" ? href : "";
  linkError.value = null;
  linkOpen.value = true;
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
  void props.model.flush();
  editor.value?.destroy();
});
</script>

<template>
  <div class="notes-widget" :style="rootStyle" data-interactive>
    <div v-if="model.state.value.toolbarVisible" class="notes-formatting" :style="formattingStyle">
      <div class="notes-toolbar" @pointerdown.stop>
        <button type="button" class="notes-btn" :class="{ active: editor?.isActive('bold') }" v-tip="'Bold'" @click="toggleBold">B</button>
        <button type="button" class="notes-btn" :class="{ active: editor?.isActive('italic') }" v-tip="'Italic'" @click="toggleItalic"><em>I</em></button>
        <button type="button" class="notes-btn" :class="{ active: editor?.isActive('underline') }" v-tip="'Underline'" @click="toggleUnderline"><span class="u">U</span></button>
        <button type="button" class="notes-btn" :class="{ active: editor?.isActive('heading', { level: 1 }) }" v-tip="'Heading 1'" @click="toggleH1">H1</button>
        <button type="button" class="notes-btn" :class="{ active: editor?.isActive('heading', { level: 2 }) }" v-tip="'Heading 2'" @click="toggleH2">H2</button>
        <button type="button" class="notes-btn" :class="{ active: editor?.isActive('bulletList') }" v-tip="'Bullet list'" @click="toggleBullet">•</button>
        <button type="button" class="notes-btn" :class="{ active: editor?.isActive('orderedList') }" v-tip="'Numbered list'" @click="toggleOrdered">1.</button>
        <button type="button" class="notes-btn" :class="{ active: editor?.isActive('link') }" v-tip="'Link'" @click="openLink">Link</button>
      </div>

      <div v-if="linkOpen" class="notes-link-pop" data-interactive @pointerdown.stop>
        <input v-model="linkDraft" class="notes-link-input" type="url" placeholder="https://…" aria-label="Link URL" @keydown.enter.prevent="applyLink" />
        <p v-if="linkError" class="notes-link-error">{{ linkError }}</p>
        <div class="notes-link-actions">
          <button type="button" class="notes-btn" @click="applyLink">OK</button>
          <button type="button" class="notes-btn" @click="removeLink">Remove</button>
          <button type="button" class="notes-btn" @click="linkOpen = false">Cancel</button>
        </div>
      </div>
    </div>

    <div class="notes-editor" @pointerdown="onEditorPointerDown">
      <EditorContent :editor="editor" />
    </div>
  </div>
</template>

<style scoped>
.notes-widget { position: relative; display: flex; flex-direction: column; flex: 1 1 auto; width: 100%; min-width: 0; min-height: 0; box-sizing: border-box; cursor: text; }
.notes-toolbar { display: flex; flex-wrap: wrap; gap: 4px; padding-bottom: 6px; border-bottom: 1px solid rgba(var(--fg-rgb), 0.08); margin-bottom: 6px; flex-shrink: 0; }
.notes-btn { appearance: none; border: 0; background: rgba(var(--fg-rgb), 0.06); color: rgba(var(--fg-rgb), 0.85); font: inherit; font-size: 12px; line-height: 1; padding: 5px 7px; border-radius: 6px; cursor: pointer; }
.notes-btn:hover { background: rgba(var(--fg-rgb), 0.12); }
.notes-btn.active { background: rgba(var(--fg-rgb), 0.18); color: #fff; }
.notes-btn .u { text-decoration: underline; }
.notes-link-pop { display: flex; flex-direction: column; gap: 6px; padding: 8px; margin-bottom: 6px; background: rgba(0, 0, 0, 0.35); border-radius: 8px; flex-shrink: 0; }
.notes-link-input { width: 100%; box-sizing: border-box; border: 1px solid rgba(var(--fg-rgb), 0.12); background: rgba(0, 0, 0, 0.25); color: #fff; border-radius: 6px; padding: 6px 8px; font: inherit; font-size: 12px; }
.notes-link-error { margin: 0; font-size: 11px; color: #f0a0a0; }
.notes-link-actions { display: flex; gap: 4px; }
.notes-editor { flex: 1; min-height: 0; overflow: auto; padding: 0 10px; }
.notes-editor :deep(.notes-prose) { outline: none; font-size: 13px; line-height: 1.45; color: rgba(var(--fg-rgb), 0.92); }
.notes-editor :deep(.notes-prose p.is-editor-empty:first-child::before) { content: "Write a note…"; color: rgba(var(--fg-rgb), 0.35); float: left; height: 0; pointer-events: none; }
.notes-editor :deep(.notes-prose h1) { font-size: 1.35em; margin: 0.4em 0 0.25em; }
.notes-editor :deep(.notes-prose h2) { font-size: 1.15em; margin: 0.35em 0 0.2em; }
.notes-editor :deep(.notes-prose ul), .notes-editor :deep(.notes-prose ol) { padding-left: 1.25em; margin: 0.35em 0; }
.notes-editor :deep(.notes-prose a) { color: #9ecbff; text-decoration: underline; }
</style>
