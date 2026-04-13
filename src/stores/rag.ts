import { defineStore } from "pinia";
import { ref } from "vue";
import type { IDBPDatabase } from "idb";
import type { RetrievedChunk } from "opensona/runtime";
import { openSessionDb, type PersistedRagEntry, type SessionDbSchema } from "@/storage/db";

/** Per PLAN §5 — raised from the legacy cap of 200. */
const MAX_ENTRIES = 500;
const SCHEMA_VERSION = 1 as const;

/**
 * Per-turn RAG diagnostic record.
 *
 * `id` is the IDB autoinc key (assigned post-write). The legacy module keyed
 * the UI off a numeric `id`; we continue doing so via IDB autoinc, which keeps
 * DebugSidebar.vue's `v-for :key="entry.id"` stable across re-renders.
 */
export interface RagLogEntry {
  schemaVersion: 1;
  id: number;
  timestamp: number;
  query: string;
  engramId: string | null;
  cutoffEventId: string | null;
  chunks: RetrievedChunk[];
  /** Assembled lore preamble pushed into the system message. */
  preamble?: string;
  /** The engram's system prompt at dispatch time. */
  systemPrompt?: string;
  /** Coarse per-phase timings in ms — `{ retrieve, assemble, total, ... }`. */
  timing?: Record<string, number>;
}

/**
 * Rag store — IDB-backed per-turn diagnostic log.
 *
 * `ragLog` is held newest-first to match DebugSidebar.vue's existing render
 * order (the legacy module prepended on append). Writes are imperative per
 * action rather than via `$subscribe` — PLAN §3 flags `$subscribe → IDB` as
 * a strategy hint, and per-action writes are simpler, avoid re-persisting
 * hydrated records, and make the MAX_ENTRIES eviction trivially atomic with
 * the IDB delete.
 */
export const useRagStore = defineStore("rag", () => {
  const ragLog = ref<RagLogEntry[]>([]);

  async function hydrate(): Promise<void> {
    let db: IDBPDatabase<SessionDbSchema>;
    try {
      db = await openSessionDb();
    } catch (err) {
      console.warn("[rag] hydrate: openSessionDb failed", err);
      return;
    }
    try {
      const all = await db.getAll("rag-log");
      const valid: RagLogEntry[] = [];
      let discarded = 0;
      for (const rec of all) {
        if (rec.schemaVersion !== 1 || rec.id === undefined) {
          discarded++;
          continue;
        }
        // Legacy shape: these fields aren't on PersistedRagEntry directly but
        // the actual records we write carry them. Cast through `unknown` and
        // defensively default the required fields.
        const full = rec as unknown as Partial<RagLogEntry> & PersistedRagEntry;
        valid.push({
          schemaVersion: 1,
          id: rec.id,
          timestamp: rec.timestamp,
          query: full.query ?? "",
          engramId: full.engramId ?? null,
          cutoffEventId: full.cutoffEventId ?? null,
          chunks: Array.isArray(full.chunks) ? full.chunks : [],
          ...(full.preamble !== undefined ? { preamble: full.preamble } : {}),
          ...(full.systemPrompt !== undefined ? { systemPrompt: full.systemPrompt } : {}),
          ...(full.timing !== undefined ? { timing: full.timing } : {}),
        });
      }
      // Newest-first for UI parity with the legacy module.
      valid.sort((a, b) => b.timestamp - a.timestamp);
      // Cap at MAX_ENTRIES. If somehow more survive a crash, drop the tail in
      // memory; we don't aggressively rewrite IDB here — the next append will
      // eventually reconcile.
      ragLog.value = valid.slice(0, MAX_ENTRIES);
      if (discarded > 0) {
        console.warn(`[rag] hydrate: discarded ${discarded} record(s) with schema mismatch`);
      }
    } catch (err) {
      console.warn("[rag] hydrate: read failed", err);
    } finally {
      db.close();
    }
  }

  async function appendEntry(
    entry: Omit<RagLogEntry, "id" | "timestamp" | "schemaVersion">,
  ): Promise<void> {
    const timestamp = Date.now();
    const record: Omit<RagLogEntry, "id"> = {
      schemaVersion: 1,
      timestamp,
      query: entry.query,
      engramId: entry.engramId,
      cutoffEventId: entry.cutoffEventId,
      chunks: entry.chunks,
      ...(entry.preamble !== undefined ? { preamble: entry.preamble } : {}),
      ...(entry.systemPrompt !== undefined ? { systemPrompt: entry.systemPrompt } : {}),
      ...(entry.timing !== undefined ? { timing: entry.timing } : {}),
    };

    let db: IDBPDatabase<SessionDbSchema>;
    try {
      db = await openSessionDb();
    } catch (err) {
      console.warn("[rag] appendEntry: openSessionDb failed", err);
      return;
    }
    try {
      // Cast is safe: the persisted shape is a superset of PersistedRagEntry
      // plus the legacy fields kept out of db.ts for leanness.
      const id = (await db.add("rag-log", record as unknown as PersistedRagEntry)) as number;
      const full: RagLogEntry = { ...record, id } as RagLogEntry;
      // Prepend — newest first.
      ragLog.value = [full, ...ragLog.value];

      // MAX_ENTRIES cap — evict tail from both memory and IDB.
      if (ragLog.value.length > MAX_ENTRIES) {
        const overflow = ragLog.value.slice(MAX_ENTRIES);
        ragLog.value = ragLog.value.slice(0, MAX_ENTRIES);
        const tx = db.transaction("rag-log", "readwrite");
        const store = tx.objectStore("rag-log");
        for (const evicted of overflow) {
          await store.delete(evicted.id);
        }
        await tx.done;
      }
    } catch (err) {
      console.warn("[rag] appendEntry: write failed", err);
    } finally {
      db.close();
    }
  }

  async function clear(): Promise<void> {
    ragLog.value = [];
    let db: IDBPDatabase<SessionDbSchema>;
    try {
      db = await openSessionDb();
    } catch (err) {
      console.warn("[rag] clear: openSessionDb failed", err);
      return;
    }
    try {
      await db.clear("rag-log");
    } catch (err) {
      console.warn("[rag] clear: clear failed", err);
    } finally {
      db.close();
    }
  }

  function exportJson(): string {
    return JSON.stringify(ragLog.value, null, 2);
  }

  return {
    ragLog,
    schemaVersion: SCHEMA_VERSION,
    hydrate,
    appendEntry,
    clear,
    exportJson,
  };
});
