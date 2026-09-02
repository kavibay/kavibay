<script setup lang="ts">
import { onMounted, ref } from "vue";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderIcon } from "@sdk/icons";
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
    <header class="folders-head">
      <h2 class="folders-title">Files and Folders</h2>
      <p class="folders-lead">
        Folders the palette can find and jump into. Type a name to open the folder,
        or press Tab on a result to search inside it.
      </p>
    </header>

    <section class="folders-block">
      <h3 class="folders-block-title">Built-in folders</h3>
      <p class="folders-block-hint">
        System folders resolved for your account. Switch off what you never search
        for — it only hides them from the palette, nothing on disk changes.
      </p>
      <label
        v-for="folder in builtinFoldersIndex"
        :key="folder.id"
        class="toggle"
        :class="{ 'toggle--off': !isBuiltinEnabled(folder.id) }"
      >
        <FolderIcon class="toggle-icon" :size="16" />
        <span class="toggle-copy">
          <span class="toggle-title">{{ folder.title }}</span>
          <span class="toggle-hint" :title="folder.path">{{ folder.path }}</span>
        </span>
        <span class="switch">
          <input
            type="checkbox"
            :checked="isBuiltinEnabled(folder.id)"
            @change="onBuiltinToggle(folder.id, $event)"
          />
          <span class="switch-ui" />
        </span>
      </label>
    </section>

    <section class="folders-block">
      <h3 class="folders-block-title">Your folders</h3>
      <p class="folders-block-hint">
        Add any folder you jump to often. Search terms are optional extra words
        that should also find it.
      </p>

      <div v-for="folder in customFolders" :key="folder.id" class="folder-card">
        <div class="folder-card-fields">
          <input
            class="folder-input"
            type="text"
            aria-label="Folder name"
            :value="folder.title"
            @change="onRename(folder.id, $event)"
            @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
          />
          <input
            class="folder-input folder-input--aliases"
            type="text"
            placeholder="Search terms (comma separated)"
            aria-label="Search terms"
            :value="formatAliasInput(folder.aliases)"
            @change="onAliases(folder.id, $event)"
            @keydown.enter.prevent="($event.target as HTMLInputElement).blur()"
          />
        </div>
        <div class="folder-card-foot">
          <span class="folder-path" :title="folder.path">{{ folder.path }}</span>
          <button
            type="button"
            class="folder-remove"
            @click="removeFolder(folder.id)"
          >
            Remove
          </button>
        </div>
      </div>

      <p v-if="customFolders.length === 0" class="folders-empty">
        No folders added yet.
      </p>

      <button
        type="button"
        class="folders-action"
        :disabled="picking"
        @click="onAddFolder"
      >
        Add folder…
      </button>
    </section>
  </div>
</template>

<style scoped>
.folders {
  display: flex;
  flex-direction: column;
  gap: 22px;
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

.folders-lead,
.folders-block-hint {
  margin: 0;
  font-size: 13px;
  line-height: 1.4;
  color: rgba(var(--fg-rgb), 0.5);
}

.folders-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.folders-block-title {
  margin: 0;
  font-size: 13px;
  font-weight: 500;
  color: rgba(var(--fg-rgb), 0.92);
}

.toggle {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border-radius: 14px;
  background: rgba(var(--fg-rgb), 0.04);
  cursor: pointer;
}

.toggle:hover {
  background: rgba(var(--fg-rgb), 0.08);
}

.toggle--off {
  opacity: 0.58;
}

.toggle-icon {
  flex: none;
  color: rgba(var(--fg-rgb), 0.55);
}

.toggle-copy {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 2px;
}

.toggle-title {
  font-size: 13px;
  font-weight: 500;
  color: rgba(var(--fg-rgb), 0.92);
}

.toggle-hint {
  font-size: 12px;
  color: rgba(var(--fg-rgb), 0.45);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.switch {
  position: relative;
  display: inline-flex;
  flex: none;
}

.switch input {
  position: absolute;
  width: 0;
  height: 0;
  opacity: 0;
}

.switch-ui {
  position: relative;
  width: 36px;
  height: 20px;
  border-radius: 999px;
  background: rgba(var(--fg-rgb), 0.15);
}

.switch-ui::after {
  content: "";
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: rgba(var(--fg-rgb), 0.85);
}

.switch input:checked + .switch-ui {
  background: rgba(var(--fg-rgb), 0.82);
}

.switch input:checked + .switch-ui::after {
  background: rgb(var(--surface-bg-rgb));
  transform: translateX(16px);
}

.switch input:focus-visible + .switch-ui {
  outline: 2px solid rgba(var(--fg-rgb), 0.55);
  outline-offset: 2px;
}

.folder-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  border-radius: 14px;
  background: rgba(var(--fg-rgb), 0.04);
}

.folder-card-fields {
  display: flex;
  gap: 8px;
}

.folder-input {
  min-width: 0;
  flex: 1;
  padding: 8px 10px;
  border: 1px solid rgba(var(--fg-rgb), 0.1);
  border-radius: 10px;
  background: rgba(var(--inset-rgb), 0.28);
  color: rgba(var(--fg-rgb), 0.92);
  font-size: 13px;
}

.folder-input--aliases {
  flex: 1.4;
}

.folder-input:focus {
  outline: none;
  border-color: rgba(var(--fg-rgb), 0.28);
  background: rgba(var(--inset-rgb), 0.4);
}

.folder-card-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.folder-path {
  min-width: 0;
  font-size: 12px;
  color: rgba(var(--fg-rgb), 0.45);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.folder-remove {
  flex-shrink: 0;
  padding: 5px 10px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: transparent;
  color: rgba(var(--fg-rgb), 0.55);
  font-size: 12px;
  cursor: pointer;
}

.folder-remove:hover {
  background: rgba(255, 120, 120, 0.14);
  color: rgba(255, 170, 170, 0.95);
}

.folders-empty {
  margin: 0;
  padding: 14px;
  border-radius: 14px;
  background: rgba(var(--fg-rgb), 0.03);
  font-size: 13px;
  color: rgba(var(--fg-rgb), 0.42);
}

.folders-action {
  align-self: flex-start;
  margin-top: 2px;
  padding: 9px 14px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: rgba(var(--fg-rgb), 0.06);
  color: rgba(var(--fg-rgb), 0.92);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}

.folders-action:hover:not(:disabled),
.folders-action:focus-visible {
  background: var(--row-selected-sheen), var(--row-selected-bg);
  box-shadow: var(--row-selected-rim), var(--row-selected-shadow);
  outline: none;
}

.folders-action:disabled {
  opacity: 0.5;
  cursor: default;
}

@media (max-width: 560px) {
  .folder-card-fields {
    flex-direction: column;
  }
}
</style>
