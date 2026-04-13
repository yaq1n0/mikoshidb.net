/**
 * Compat shim — the real store lives in `@/stores/rag`.
 *
 * Step 6 of the state-management migration moved the rag log to Pinia + IDB.
 * DebugSidebar.vue and any other callers still import from this module; this
 * shim delegates to the store so nothing else has to change until the Step 9
 * UI rewrite.
 *
 * Legacy localStorage key `mikoshi.rag.log` is dropped silently per PLAN §2.
 */
import { computed } from "vue";
import { useRagStore, type RagLogEntry } from "@/stores/rag";

export type { RagLogEntry };

/**
 * Reactive view over the store's newest-first array. DebugSidebar.vue uses
 * `ragLog.length` and `v-for="entry in ragLog"` — a computed ref preserves
 * both (Vue unwraps computeds in templates, and `.value` in script).
 */
export const ragLog = computed<RagLogEntry[]>(() => useRagStore().ragLog);

/**
 * Fire-and-forget; callers historically didn't await. The store performs an
 * IDB write and reactive update; any failure is logged inside the store.
 */
export const appendRagLog = (entry: Omit<RagLogEntry, "id" | "timestamp" | "schemaVersion">): void => {
  void useRagStore().appendEntry(entry);
};

/** Clears rag log. */
export const clearRagLog = (): void => {
  void useRagStore().clear();
};

/** Export rag log json. */
export const exportRagLogJson = (): string => {
  return useRagStore().exportJson();
};
