import { defineStore } from "pinia";
import { ref } from "vue";

const SCHEMA_VERSION = 1 as const;

/**
 * Match App.vue's historical drag-resize bounds exactly so the silent drop of
 * the legacy `mikoshi.debug.width` localStorage key doesn't visibly shift the
 * default pane width.
 */
export const MIN_W = 240;
export const MAX_W = 900;
const DEFAULT_W = 400;

export type DebugTab = "rag" | "prompts" | "cache" | "session";

/**
 * Debug pane store — owns the resizable pane width, the active tab, and the
 * per-entry / per-text expansion state shared between tab components. All
 * fields persist via the pinia plugin to localStorage under `mikoshi.debug`.
 *
 * Schema-version mismatch on load → silently reset to defaults (same pattern
 * as useTerminalStore).
 *
 * `expandedEntries` keys are stringified rag-entry ids (the IDB autoinc id).
 * `expandedTexts` keys are arbitrary composite strings — RagTab uses
 * `${entryId}:${chunkIdx}` for chunk text expansion; PromptsTab uses
 * `${entryId}:preamble` and `${entryId}:systemPrompt`.
 */
export const useDebugStore = defineStore(
  "debug",
  () => {
    const debugWidth = ref<number>(DEFAULT_W);
    const activeTab = ref<DebugTab>("rag");
    const expandedEntries = ref<Record<string, boolean>>({});
    const expandedTexts = ref<Record<string, boolean>>({});
    const schemaVersion = ref<number>(SCHEMA_VERSION);

    function init(): void {
      if (schemaVersion.value !== SCHEMA_VERSION) {
        debugWidth.value = DEFAULT_W;
        activeTab.value = "rag";
        expandedEntries.value = {};
        expandedTexts.value = {};
        schemaVersion.value = SCHEMA_VERSION;
        return;
      }
      // Defensive clamp in case persisted width predates a constants change or
      // someone hand-edited localStorage.
      if (
        !Number.isFinite(debugWidth.value) ||
        debugWidth.value < MIN_W ||
        debugWidth.value > MAX_W
      ) {
        debugWidth.value = DEFAULT_W;
      }
    }

    function setWidth(w: number): void {
      const clamped = Math.max(MIN_W, Math.min(MAX_W, w));
      debugWidth.value = clamped;
    }

    function setActiveTab(tab: DebugTab): void {
      activeTab.value = tab;
    }

    function toggleEntry(id: string | number): void {
      const key = String(id);
      const next = { ...expandedEntries.value };
      if (next[key]) delete next[key];
      else next[key] = true;
      expandedEntries.value = next;
    }

    function isEntryExpanded(id: string | number): boolean {
      return Boolean(expandedEntries.value[String(id)]);
    }

    function toggleText(key: string): void {
      const next = { ...expandedTexts.value };
      if (next[key]) delete next[key];
      else next[key] = true;
      expandedTexts.value = next;
    }

    function isTextExpanded(key: string): boolean {
      return Boolean(expandedTexts.value[key]);
    }

    init();

    return {
      debugWidth,
      activeTab,
      expandedEntries,
      expandedTexts,
      schemaVersion,
      setWidth,
      setActiveTab,
      toggleEntry,
      isEntryExpanded,
      toggleText,
      isTextExpanded,
    };
  },
  {
    persist: {
      key: "mikoshi.debug",
      storage: {
        getItem: (k: string): string | null =>
          typeof localStorage !== "undefined" ? localStorage.getItem(k) : null,
        setItem: (k: string, v: string): void => {
          if (typeof localStorage !== "undefined") localStorage.setItem(k, v);
        },
      },
      pick: ["debugWidth", "activeTab", "expandedEntries", "expandedTexts", "schemaVersion"],
    },
  },
);
