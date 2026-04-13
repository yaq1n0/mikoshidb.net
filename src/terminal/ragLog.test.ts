import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { IDBFactory } from "fake-indexeddb";
import { appendRagLog, clearRagLog, exportRagLogJson, ragLog } from "@/terminal/ragLog";
import { useRagStore } from "@/stores/rag";

/** Yield a macrotask tick so fake-indexeddb can settle its I/O. */
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("ragLog shim", () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    setActivePinia(createPinia());
  });

  it("appendRagLog fires into the store; entry is visible on ragLog", async () => {
    appendRagLog({
      query: "q",
      engramId: "e",
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
    });
    for (let i = 0; i < 50 && ragLog.value.length === 0; i++) {
      await tick();
    }
    expect(ragLog.value.length).toBe(1);
    expect(ragLog.value[0]!.query).toBe("q");
  });

  it("exportRagLogJson returns a parseable JSON array", () => {
    const json = exportRagLogJson();
    const parsed = JSON.parse(json);
    expect(Array.isArray(parsed)).toBe(true);
  });

  it("clearRagLog delegates to store.clear", async () => {
    const store = useRagStore();
    await store.appendEntry({
      query: "q",
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
    });
    expect(store.ragLog.length).toBe(1);
    clearRagLog();
    // store.clear sets ragLog.value = [] synchronously before its first await.
    expect(store.ragLog.length).toBe(0);
  });
});
