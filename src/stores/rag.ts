import { defineStore } from "pinia";
import { ref } from "vue";
import type { IDBPDatabase } from "idb";
import type {
  ResolverInput,
  RetrievedChunk,
  TraversalDirective,
} from "opensona/runtime";
import type { ResolverMessage, TraverseTrace } from "opensona/runtime";
import { openSessionDb, type PersistedRagEntry, type SessionDbSchema } from "@/storage/db";

/** Per PLAN §5 — raised from the legacy cap of 200. */
const MAX_ENTRIES = 500;
const SCHEMA_VERSION = 2 as const;

/** Outcome marker for the resolver round-trip. */
export type ResolverFallback = "none" | "empty-directive" | "parse-error" | "throw";

/**
 * Per-turn RAG diagnostic record — graph-rag shape (schemaVersion 2).
 *
 * `id` is the IDB autoinc key (assigned post-write). DebugSidebar.vue keys
 * its `v-for` off `entry.id`, so the autoinc value must remain stable.
 */
export interface RagLogEntry {
  schemaVersion: 2;
  id: number;
  timestamp: number;
  query: string;
  engramId: string | null;
  cutoffEventId: string | null;
  resolverInput: ResolverInput | null;
  resolverMessages: ResolverMessage[];
  resolverRaw: string;
  resolverOutput: TraversalDirective | { error: string; raw: string } | null;
  resolverFallback: ResolverFallback;
  resolvedEntities: Array<{ alias: string; articleId: string }>;
  traversalNodes: TraverseTrace["nodes"];
  selected: RetrievedChunk[];
  preamble: string;
  systemPrompt: string;
  timing: Record<string, number>;
}

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
        if (rec.schemaVersion !== 2 || rec.id === undefined) {
          discarded++;
          continue;
        }
        const full = rec as unknown as Partial<RagLogEntry> & PersistedRagEntry;
        valid.push({
          schemaVersion: 2,
          id: rec.id,
          timestamp: rec.timestamp,
          query: full.query ?? "",
          engramId: full.engramId ?? null,
          cutoffEventId: full.cutoffEventId ?? null,
          resolverInput: (full.resolverInput as ResolverInput | null) ?? null,
          resolverMessages: (full.resolverMessages as ResolverMessage[]) ?? [],
          resolverRaw: full.resolverRaw ?? "",
          resolverOutput: (full.resolverOutput as RagLogEntry["resolverOutput"]) ?? null,
          resolverFallback: full.resolverFallback ?? "none",
          resolvedEntities: full.resolvedEntities ?? [],
          traversalNodes: (full.traversalNodes as TraverseTrace["nodes"]) ?? [],
          selected: (full.selected as RetrievedChunk[]) ?? [],
          preamble: full.preamble ?? "",
          systemPrompt: full.systemPrompt ?? "",
          timing: full.timing ?? {},
        });
      }
      valid.sort((a, b) => b.timestamp - a.timestamp);
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
      schemaVersion: 2,
      timestamp,
      ...entry,
    };

    let db: IDBPDatabase<SessionDbSchema>;
    try {
      db = await openSessionDb();
    } catch (err) {
      console.warn("[rag] appendEntry: openSessionDb failed", err);
      return;
    }
    try {
      const id = (await db.add("rag-log", record as unknown as PersistedRagEntry)) as number;
      const full: RagLogEntry = { ...record, id } as RagLogEntry;
      ragLog.value = [full, ...ragLog.value];

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
