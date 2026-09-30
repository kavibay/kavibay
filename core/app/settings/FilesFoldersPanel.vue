<script setup lang="ts">
import { onMounted, ref } from "vue";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderIcon, Trash2Icon } from "@sdk/icons";
import {
  builtinFoldersIndex,
  ensureKnownFoldersIndex,
} from "../palette/knownFolders";
import { formatAliasInput, parseAliasInput } from "./folderPrefsLogic";
import { useFolderPrefs } from "./useFolderPrefs";

const {
  customFolders,
  isBuiltinEnabled,
  setBuiltinEnabled,
  addFolder,
  removeFolder,
  renameFolder,
  setFolderAliases,
} = useFolderPrefs();

/** Set while the native picker is open — it must not be launched twice. */
const picking = ref(false);

// The list is resolved once per session; this panel may ask for it first.
onMounted(() => {
  void ensureKnownFoldersIndex();
});

/** Toggle whether a built-in folder shows up in palette search. */
function onBuiltinToggle(id: string, event: Event) {
  setBuiltinEnabled(id, (event.target as HTMLInputElement).checked);
}

/** Pick a folder with the OS dialog and add it to the catalog. */
async function onAddFolder() {
  if (picking.value) return;
  picking.value = true;
  try {
    const picked = await open({
      directory: true,
      multiple: false,
      title: "Add folder to palette search",
    });
    if (typeof picked === "string") addFolder(picked);
  } catch {
    // Cancelled or unavailable — nothing to add.
  } finally {
    picking.value = false;
  }
}

/** Commit a renamed folder on blur / Enter. */
function onRename(id: string, event: Event) {
  renameFolder(id, (event.target as HTMLInputElement).value);
}

/** Commit edited search terms on blur / Enter. */
function onAliases(id: string, event: Event) {
  setFolderAliases(id, parseAliasInput((event.target as HTMLInputElement).value));
}
</script>

<template>
  <div class="folders">
    <Teleport to=".settings-sticky">
    <header class="folders-head">
      <h2 class="folders-title">Files and Folders</h2>
      <p class="folders-lead">
        Folders the palette can find and jump into. Type a name to open the folder,
        or press Tab on a result to search inside it.
      </p>
    </header>
    </Teleport>

    <section class="settings-section">
      <h3 class="settings-section-title">Built-in folders</h3>
      <p class="settings-section-hint">
        Switch off what you never search for. It only hides them from the palette;
        nothing on disk changes.
      </p>
      <label v-for="folder in builtinFoldersIndex" :key="folder.id" class="settings-row">
        <span class="folder-lead" :class="{ 'folder-lead--off': !isBuiltinEnabled(folder.id) }">
          <span class="folder-tile" data-icon-tile>
            <FolderIcon :size="16" />
          </span>
          <span class="settings-row-copy">
            <span class="settings-row-title">{{ folder.title }}</span>
            <span class="settings-row-hint folder-path" :title="folder.path">{{ folder.path }}</span>
          </span>
        </span>
        <span class="switch">
          <input
            type="checkbox"
            :aria-label="`Show ${folder.title} in palette search`"
            :checked="isBuiltinEnabled(folder.id)"
            @change="onBuiltinToggle(folder.id, $event)"
          />
          <span class="switch-ui" />
        </span>
      </label>
    </section>

    <section class="settings-section">
      <h3 class="settings-section-title">Your folders</h3>

      <div v-for="folder in customFolders" :key="folder.id" class="settings-row">
        <span class="folder-lead">
          <span class="folder-tile" data-icon-tile>
            <FolderIcon :size="16" />
          </span>
          <span class="settings-row-copy">
            <!-- Reads as the row title; the field only shows itself on hover / focus. -->
            <input
              class="folder-name"
              type="text"
              aria-label="Folder name"
              :value="folder.title"
              @change="onRename(folder.id, $event)"
              @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
            />
            <span class="settings-row-hint folder-path" :title="folder.path">{{ folder.path }}</span>
          </span>
        </span>
        <span class="folder-controls">
          <input
            class="folder-aliases"
            type="text"
            placeholder="Search terms, comma separated"
            aria-label="Search terms"
            :value="formatAliasInput(folder.aliases)"
            @change="onAliases(folder.id, $event)"
            @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
          />
          <button
            type="button"
            class="folder-remove"
            :aria-label="`Remove ${folder.title}`"
            :title="`Remove ${folder.title}`"
            @click="removeFolder(folder.id)"
          >
            <Trash2Icon :size="15" />
          </button>
        </span>
      </div>

      <div class="settings-row">
        <span class="settings-row-copy">
          <span class="settings-row-title">Add a folder</span>
          <span class="settings-row-hint">
            Any folder you jump to often. Search terms are optional extra words that
            also find it.
          </span>
        </span>
        <button
          type="button"
          class="folders-action"
          :disabled="picking"
          @click="onAddFolder"
        >
          Add folder…
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.folders {
  display: flex;
  flex-direction: column;
  gap: 28px;
  padding-bottom: 8px;
}

.folders-head {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.folders-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: rgba(var(--fg-rgb), 0.95);
}

.folders-lead {
  margin: 0;
  font-size: 13px;
  line-height: 1.4;
  color: rgba(var(--fg-rgb), 0.5);
}

.folder-lead {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.folder-lead--off {
  opacity: 0.5;
}

/* The palette's icon tile; FolderIcon colours it through the --icon-tile-* vars. */
.folder-tile {
  flex: none;
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  color: var(--icon-tile-fg, currentColor);
  background: var(--icon-tile-bg, rgba(var(--fg-rgb), 0.08));
}

.folder-path {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.folder-name {
  min-width: 0;
  margin: -2px 0 -2px -6px;
  padding: 2px 6px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: rgba(var(--fg-rgb), 0.92);
  font: inherit;
  font-size: 13px;
  font-weight: 500;
}

.folder-name:hover {
  background: rgba(var(--fg-rgb), 0.05);
}

.folder-name:focus {
  outline: none;
  border-color: rgba(var(--fg-rgb), 0.2);
  background: rgba(var(--inset-rgb), 0.3);
}

.folder-controls {
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
}

.folder-aliases {
  width: 220px;
  padding: 6px 10px;
  border: 1px solid rgba(var(--fg-rgb), 0.1);
  border-radius: 8px;
  background: rgba(var(--inset-rgb), 0.2);
  color: rgba(var(--fg-rgb), 0.92);
  font: inherit;
  font-size: 12px;
}

.folder-aliases::placeholder {
  color: rgba(var(--fg-rgb), 0.4);
}

.folder-aliases:focus {
  outline: none;
  border-color: rgba(var(--fg-rgb), 0.28);
  background: rgba(var(--inset-rgb), 0.35);
}

.folder-remove {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: rgba(var(--fg-rgb), 0.5);
  cursor: pointer;
}

.folder-remove:hover,
.folder-remove:focus-visible {
  outline: none;
  background: rgba(255, 120, 120, 0.14);
  color: rgba(255, 170, 170, 0.95);
}

.folders-action {
  flex: none;
  padding: 6px 12px;
  border: 1px solid rgba(var(--fg-rgb), 0.12);
  border-radius: 8px;
  background: transparent;
  color: rgba(var(--fg-rgb), 0.92);
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}

.folders-action:hover:not(:disabled),
.folders-action:focus-visible {
  background: rgba(var(--fg-rgb), 0.06);
  outline: none;
}

.folders-action:disabled {
  opacity: 0.5;
  cursor: default;
}

@media (max-width: 560px) {
  .folder-aliases {
    width: 100%;
  }

  .folder-controls {
    flex: 1;
  }
}
</style>
