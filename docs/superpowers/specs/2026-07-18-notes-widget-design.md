# Notes Widget — Design

**Date:** 2026-07-18  
**Status:** Approved for implementation planning  
**Approach:** TipTap WYSIWYG + per-instance `localStorage` (approach 1)

## Goal

Add a resizable Notes widget to the Kavibay overlay: one WYSIWYG notepad per widget instance, with a formatting toolbar (bold, italic, underline, H1/H2, lists, links). Content is stored as markdown under the hood and restored across restarts.

## Requirements

### Behavior

- Registry widget `notes`, title “Notes”, inside existing `WidgetCard`
- **One document per instance** — duplicate widget → new instance with seeded copy of markdown + size (Image / App Launcher pattern); remove clears storage
- **WYSIWYG** via TipTap; user never edits raw markdown in V1
- **Toolbar:** Bold, Italic, Underline, H1, H2, bullet list, numbered list, link (insert/edit URL)
- **Keyboard shortcuts:** use TipTap / StarterKit defaults where available (e.g. Ctrl/Cmd+B, I)
- **Autosave:** debounced persist (~300ms) of markdown + size on edit/resize
- **Resize:** bottom-right grip (Image pattern); width/height clamped and persisted
- **Empty state:** placeholder text e.g. “Write a note…”
- **Title:** instance title via WidgetCard ⋯ rename; note body is separate from the card title
- **No settings panel** in V1

### Visual

- Dark glass `WidgetCard` chrome; no custom outer chrome
- Compact toolbar row above the editor; active formats highlighted
- Editor fills remaining content area; internal scroll when content overflows
- Normal card padding (not `flush` unless implementation needs edge-to-edge for the grip)
- Match existing overlay look (muted controls, no second “app chrome” frame)

### Out of scope (V1)

- Multiple notes / folders / search inside one widget
- Images or file attachments in the note
- Sync, export, import
- Raw markdown split view or source toggle
- Collaborative editing
- Settings panel (font size, theme, etc.)
- Blockquotes, code blocks, tables, task lists (beyond the agreed toolbar)

## Architecture

### Approach

| Layer | Responsibility |
|-------|----------------|
| Frontend `NotesWidget.vue` | Toolbar, TipTap editor, resize grip, placeholder |
| Logic `notesLogic.ts` | Types, size clamp, load/save, normalize |
| Composable `useNotesState.ts` | Per-`instanceId` cache, debounced persist, dispose, seed-on-duplicate |
| TipTap | WYSIWYG editing; markdown serialize/deserialize |
| `localStorage` | Persist `{ markdown, width, height }` per instance |

No `backendCommand` / Rust. Pure client-side widget.

### Frontend files

| File | Role |
|------|------|
| `src/widgets/NotesWidget.vue` | UI |
| `src/widgets/notesLogic.ts` | Pure persistence + types + helpers |
| `src/widgets/useNotesState.ts` | Instance cache, debounce, dispose, seed |
| `src/widgets/registry.ts` | Register `notes` |
| `src/widgets/WidgetHost.vue` | Duplicate/remove seed/dispose hooks |
| `src/widgets/layoutLogic.ts` | Default instance via `defaultInstances` (registry-driven) |
| `package.json` | TipTap + markdown bridge deps |

Default registry offset: place to avoid overlap with existing widgets (e.g. right of palette below calculator stack); adjust at implementation.

### Dependencies

| Package | Role |
|---------|------|
| `@tiptap/vue-3` | Vue 3 TipTap component / editor |
| `@tiptap/starter-kit` | Headings, bold, italic, lists, history, etc. |
| `@tiptap/extension-underline` | Underline (not in StarterKit) |
| `@tiptap/extension-link` | Links |
| Markdown bridge | Prefer `tiptap-markdown` (or equivalent maintained TipTap markdown extension) for load/save as markdown string |

Underline is not standard CommonMark; persistence may include HTML `<u>` (or the bridge’s equivalent) inside the markdown string. That is acceptable for V1 as long as round-trip is stable in TipTap.

Link rules: only apply `http:` / `https:` URLs; reject or ignore invalid input when setting a link.

### Data model

```ts
interface NotesWidgetState {
  /** Markdown (possibly with HTML underline) for the document body */
  markdown: string;
  /** Widget content width in CSS pixels */
  width: number;
  /** Widget content height in CSS pixels */
  height: number;
}
```

Storage key: `kavibay:notes-widget:{instanceId}`.

Suggested size defaults (tunable at implement):

| Constant | Value |
|----------|-------|
| `DEFAULT_WIDTH` | 280 |
| `DEFAULT_HEIGHT` | 200 |
| `MIN_WIDTH` | 180 |
| `MIN_HEIGHT` | 120 |
| `MAX_WIDTH` | 900 |
| `MAX_HEIGHT` | 700 |

Corrupt or missing storage → empty markdown + default size.

### Data flow

1. Mount → `useNotesState(instanceId)` loads state → TipTap `setContent` from markdown
2. User edits → TipTap `update` → debounce → serialize markdown → `saveState`
3. Resize drag → clamp size → persist with current markdown
4. Duplicate instance → `seedNotesStateFrom(fromId, toId)` copies markdown + size
5. Remove instance → `disposeNotesState` + `clearNotesState` (remove `localStorage` key)

### Error handling

- Corrupt JSON / wrong shape → normalize to empty note + defaults (no crash)
- Invalid link URL → do not set link; optional brief inline feedback
- TipTap init failure → show short error string in the card body (rare)

### Testing / success criteria

- Add Notes widget; type and apply each toolbar format; restart app → content and size restored
- Duplicate → independent copy; editing one does not change the other
- Remove → `localStorage` key gone
- Resize stays within min/max and persists
- Markdown round-trip covers bold, italic, underline, H1, H2, bullet/numbered lists, links

## Decisions log

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Editing UX | WYSIWYG (TipTap) | Best notepad feel; markdown under the hood |
| Document model | One doc per instance | Matches Image / App Launcher; simplest V1 |
| Formatting scope | B/I/U, H1/H2, lists, links | User request; stop before code/tables |
| Persistence | `localStorage` per instance | Same pattern as Image size / App Launcher |
| Backend | None | No files or OS APIs required |
| Markdown bridge | TipTap markdown extension | Keeps “markdown should work” without a raw editor |
