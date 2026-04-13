import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { IDBFactory } from "fake-indexeddb";
import { useRagStore, type RagLogEntry } from "@/stores/rag";
import { openSessionDb, type PersistedRagEntry } from "@/storage/db";

type StubInput = Omit<RagLogEntry, "id" | "timestamp" | "schemaVersion">;

/** Stub. */
const stub = (overrides: Partial<StubInput> = {}): StubInput => {
  return {
    query: "",
    engramId: null,
    cutoffEventId: null,
    resolverInput: null,
    resolverMessages: [],
    resolverRaw: "",
    resolverOutput: null,
    resolverFallback: "none",
    resolvedEntities: [],
    traversalNodes: [],
    selected: [],
    preamble: "",
    systemPrompt: "",
    timing: {},
    ...overrides,
  };
};

describe("useRagStore", () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    setActivePinia(createPinia());
  });

  it("hydrate from empty IDB yields empty array", async () => {
    const store = useRagStore();
    await store.hydrate();
    expect(store.ragLog).toEqual([]);
  });

  it("appendEntry writes to IDB and prepends in-memory (newest-first)", async () => {
    const store = useRagStore();
    await store.appendEntry(stub({ query: "who is v", engramId: "v-pre" }));
    await store.appendEntry(
      stub({
        query: "what is arasaka",
        engramId: "v-pre",
        preamble: "lore: ...",
        systemPrompt: "you are v",
        timing: { resolve: 12, traverse: 3, assemble: 3, total: 20 },
      }),
    );

    expect(store.ragLog.map((e) => e.query)).toEqual(["what is arasaka", "who is v"]);
    expect(store.ragLog[0]!.preamble).toBe("lore: ...");
    expect(store.ragLog[0]!.systemPrompt).toBe("you are v");
    expect(store.ragLog[0]!.timing).toEqual({ resolve: 12, traverse: 3, assemble: 3, total: 20 });
    expect(store.ragLog[0]!.schemaVersion).toBe(2);
    expect(typeof store.ragLog[0]!.id).toBe("number");

    const db = await openSessionDb();
    const all = await db.getAll("rag-log");
    db.close();
    expect(all.length).toBe(2);
    expect(all.every((r) => r.schemaVersion === 2)).toBe(true);
  });

  it("MAX_ENTRIES cap evicts oldest from both memory and IDB", async () => {
    const store = useRagStore();
    for (let i = 0; i < 502; i++) {
      await store.appendEntry(stub({ query: `q-${i}` }));
    }

    expect(store.ragLog.length).toBe(500);
    expect(store.ragLog[0]!.query).toBe("q-501");
    expect(store.ragLog[499]!.query).toBe("q-2");
    expect(store.ragLog.find((e) => e.query === "q-0")).toBeUndefined();
    expect(store.ragLog.find((e) => e.query === "q-1")).toBeUndefined();

    const db = await openSessionDb();
    const all = await db.getAll("rag-log");
    db.close();
    expect(all.length).toBe(500);
    const queries = new Set(all.map((r) => (r as unknown as { query: string }).query));
    expect(queries.has("q-0")).toBe(false);
    expect(queries.has("q-1")).toBe(false);
    expect(queries.has("q-2")).toBe(true);
    expect(queries.has("q-501")).toBe(true);
  });

  it("schemaVersion mismatch during hydrate is skipped gracefully", async () => {
    const db = await openSessionDb();
    const ts = Date.now();
    await db.add("rag-log", {
      ...stub({ query: "ok" }),
      schemaVersion: 2,
      timestamp: ts,
    } as unknown as PersistedRagEntry);
    await db.add("rag-log", {
      ...stub({ query: "bogus" }),
      schemaVersion: 1,
      timestamp: ts + 1,
    } as unknown as PersistedRagEntry);
    db.close();

    const store = useRagStore();
    await store.hydrate();

    expect(store.ragLog.map((e) => e.query)).toEqual(["ok"]);
  });

  it("clear empties both in-memory and IDB", async () => {
    const store = useRagStore();
    await store.appendEntry(stub({ query: "q" }));
    expect(store.ragLog.length).toBe(1);

    await store.clear();
    expect(store.ragLog).toEqual([]);

    const db = await openSessionDb();
    const all = await db.getAll("rag-log");
    db.close();
    expect(all).toEqual([]);
  });

  it("hydrate orders newest-first by timestamp", async () => {
    const db = await openSessionDb();
    const base = Date.now();
    for (const [i, ts] of [
      [0, base + 100],
      [1, base + 50],
      [2, base + 200],
    ] as const) {
      await db.add("rag-log", {
        ...stub({ query: `q-${i}` }),
        schemaVersion: 2,
        timestamp: ts,
      } as unknown as PersistedRagEntry);
    }
    db.close();

    const store = useRagStore();
    await store.hydrate();
    expect(store.ragLog.map((e) => e.query)).toEqual(["q-2", "q-0", "q-1"]);
  });

  it("exportJson produces a parseable snapshot of ragLog", async () => {
    const store = useRagStore();
    await store.appendEntry(stub({ query: "q", engramId: "e" }));
    const json = store.exportJson();
    const parsed = JSON.parse(json);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].query).toBe("q");
  });
});
