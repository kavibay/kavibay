/**
 * Curated well-known user folders for palette search (Desktop, Downloads, …).
 * Paths come from Tauri's path API (Windows Known Folders / xdg / macOS).
 *
 * What the palette actually searches is this list minus the entries the user
 * switched off, plus the folders they added themselves — see
 * `settings/folderPrefsLogic.ts`.
 */
import {
  audioDir,
  desktopDir,
  documentDir,
  downloadDir,
  homeDir,
  pictureDir,
  videoDir,
} from "@tauri-apps/api/path";
import { computed, shallowRef, type ComputedRef, type ShallowRef } from "vue";
import {
  mergeFolderCatalog,
  type FolderCatalogEntry,
} from "../settings/folderPrefsLogic";
import { useFolderPrefs } from "../settings/useFolderPrefs";

/** One resolved folder ready for palette matching. */
export type KnownFolderEntry = FolderCatalogEntry;

type FolderSpec = {
  id: string;
  title: string;
  aliases: string[];
  resolve: () => Promise<string>;
};

/** Small fixed catalog — not a full filesystem index. */
const FOLDER_SPECS: readonly FolderSpec[] = [
  {
    id: "desktop",
    title: "Desktop",
    aliases: ["desktop", "schreibtisch"],
    resolve: desktopDir,
  },
  {
    id: "downloads",
    title: "Downloads",
    aliases: ["downloads", "download", "dl", "herunterladen"],
    resolve: downloadDir,
  },
  {
    id: "documents",
    title: "Documents",
    aliases: ["documents", "document", "docs", "dokumente"],
    resolve: documentDir,
  },
  {
    id: "pictures",
    title: "Pictures",
    aliases: ["pictures", "picture", "photos", "images", "bilder", "fotos"],
    resolve: pictureDir,
  },
  {
    id: "music",
    title: "Music",
    aliases: ["music", "audio", "musik"],
    resolve: audioDir,
  },
  {
    id: "videos",
    title: "Videos",
    aliases: ["videos", "video", "movies", "filme"],
    resolve: videoDir,
  },
  {
    id: "home",
    title: "Home",
    aliases: ["home", "user", "profile", "benutzer"],
    resolve: homeDir,
  },
];

/**
 * Resolved built-in folders, before the user's on/off choices.
 * Kept separate from the searchable catalog: code that needs a specific system
 * path (e.g. home for `~` completion) must not depend on search prefs.
 */
export const builtinFoldersIndex: ShallowRef<KnownFolderEntry[]> = shallowRef([]);

const { prefs: folderPrefs } = useFolderPrefs();

/** Reactive snapshot the palette searches: enabled built-ins + user folders. */
export const knownFoldersIndex: ComputedRef<KnownFolderEntry[]> = computed(() =>
  mergeFolderCatalog(builtinFoldersIndex.value, folderPrefs.value),
);

let inflight: Promise<KnownFolderEntry[]> | null = null;
let loaded = false;

/**
 * Resolve well-known folder paths once (safe to call often).
 * Skips entries whose path API fails on this platform.
 */
export async function ensureKnownFoldersIndex(): Promise<KnownFolderEntry[]> {
  if (loaded && builtinFoldersIndex.value.length > 0) return builtinFoldersIndex.value;
  if (inflight) return inflight;

  inflight = (async () => {
    const out: KnownFolderEntry[] = [];
    for (const spec of FOLDER_SPECS) {
      try {
        const path = (await spec.resolve()).trim();
        if (!path) continue;
        out.push({
          id: spec.id,
          title: spec.title,
          path,
          aliases: [...spec.aliases],
        });
      } catch {
        // Folder unavailable on this OS / profile — skip.
      }
    }
    builtinFoldersIndex.value = out;
    loaded = true;
    return out;
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}
