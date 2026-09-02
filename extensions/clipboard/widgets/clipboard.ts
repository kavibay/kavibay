// SPDX-License-Identifier: MIT
import { onScopeDispose, ref, type Ref } from "vue";
import { defineWidget, type WidgetContext } from "@sdk/contract/sdk";
import { displayText, normalizeList, type ClipboardEntry } from "../clipboardLogic";

export interface ClipboardModel {
  entries: Ref<ClipboardEntry[]>;
  error: Ref<string | null>;
  loading: Ref<boolean>;
  copiedId: Ref<string | null>;
  refresh(): Promise<void>;
  restore(id: string): Promise<void>;
  setRevealed(id: string, revealed: boolean): Promise<void>;
  remove(id: string): Promise<void>;
  clearAll(): Promise<void>;
  imageUrl(path: string): string;
  sourceIcon(entry: ClipboardEntry): string | null;
  displayText(entry: ClipboardEntry): string;
}

const POLL_MS = 1_000;

function errorMessage(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === "string") return cause;
  try {
    return JSON.stringify(cause) ?? String(cause);
  } catch {
    return String(cause);
  }
}

export const clipboardWidget = defineWidget({
  name: "clipboard",
  displayName: "Clipboard",
  description: "Recent clipboard history.",
  defaultSize: { w: 560, h: 340 },
  minSize: { w: 360, h: 220 },
  mode: "both",
  capabilities: { clipboard: true, launcher: true },
  component: {
    setup(ctx: WidgetContext): ClipboardModel {
      const entries = ref<ClipboardEntry[]>([]);
      const error = ref<string | null>(null);
      const loading = ref(true);
      const copiedId = ref<string | null>(null);
      const sourceIcons = ref<Record<string, string>>({});
      const requestedSourceIcons = new Set<string>();
      let copiedTimer: ReturnType<typeof setTimeout> | undefined;
      let request: Promise<void> | undefined;

      const loadSourceIcons = (nextEntries: ClipboardEntry[]) => {
        for (const entry of nextEntries) {
          const path = entry.sourceApp?.path;
          if (!path || sourceIcons.value[path] || requestedSourceIcons.has(path)) continue;
          requestedSourceIcons.add(path);
          void ctx.launcher!
            .extractIcon(path)
            .then((icon) => {
              sourceIcons.value = { ...sourceIcons.value, [path]: icon };
            })
            .catch(() => {
              // Source metadata is useful on its own; an inaccessible shell
              // icon should not turn a valid clipboard entry into an error.
            });
        }
      };

      const refresh = (): Promise<void> => {
        if (request) return request;
        request = (async () => {
          try {
            const nextEntries = normalizeList(await ctx.clipboard!.list<unknown>());
            entries.value = nextEntries;
            loadSourceIcons(nextEntries);
          } catch (cause) {
            error.value = `Clipboard refresh failed: ${errorMessage(cause)}`;
          } finally {
            loading.value = false;
          }
        })().finally(() => {
          request = undefined;
        });
        return request;
      };

      const flashCopied = (id: string) => {
        copiedId.value = id;
        if (copiedTimer) clearTimeout(copiedTimer);
        copiedTimer = setTimeout(() => { copiedId.value = null; }, 1_000);
      };

      const restore = async (id: string) => {
        try {
          await ctx.clipboard!.restore(id);
          flashCopied(id);
          error.value = null;
          await refresh();
        } catch (cause) {
          error.value = `Copy failed: ${errorMessage(cause)}`;
        }
      };

      const setRevealed = async (id: string, revealed: boolean) => {
        const previous = entries.value;
        entries.value = previous.map((entry) =>
          entry.id === id ? { ...entry, revealed } : entry,
        );
        try {
          await ctx.clipboard!.setRevealed(id, revealed);
          error.value = null;
        } catch (cause) {
          entries.value = previous;
          error.value = `Preview update failed: ${errorMessage(cause)}`;
        }
      };

      const remove = async (id: string) => {
        try {
          await ctx.clipboard!.delete(id);
          error.value = null;
          await refresh();
        } catch (cause) {
          error.value = `Delete failed: ${errorMessage(cause)}`;
        }
      };

      const clearAll = async () => {
        try {
          await ctx.clipboard!.clear();
          entries.value = [];
          error.value = null;
        } catch (cause) {
          error.value = `Clear failed: ${errorMessage(cause)}`;
        }
      };

      const timer = setInterval(() => void refresh(), POLL_MS);
      onScopeDispose(() => {
        clearInterval(timer);
        if (copiedTimer) clearTimeout(copiedTimer);
      });
      void refresh();

      return {
        entries,
        error,
        loading,
        copiedId,
        refresh,
        restore,
        setRevealed,
        remove,
        clearAll,
        imageUrl: (path) => ctx.clipboard!.imageUrl(path),
        sourceIcon: (entry) => {
          const path = entry.sourceApp?.path;
          return path ? sourceIcons.value[path] ?? null : null;
        },
        displayText,
      };
    },
  },
});
