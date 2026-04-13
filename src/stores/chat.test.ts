import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { IDBFactory } from "fake-indexeddb";
import { useChatStore } from "@/stores/chat";
import { openSessionDb, type PersistedChatSession } from "@/storage/db";

const KEY = "current";

/** Flush microtasks. */
const flushMicrotasks = (): Promise<void> => {
  return new Promise((r) => setTimeout(r, 0));
};

// $subscribe runs on a trailing 250ms debounce — tests that want to observe a
// persisted write need to wait past that window.
/** Wait for persist. */
const waitForPersist = (): Promise<void> => {
  return new Promise((r) => setTimeout(r, 320));
};

describe("useChatStore", () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    setActivePinia(createPinia());
  });

  it("hydrate from empty IDB leaves state empty", async () => {
    const store = useChatStore();
    await store.hydrate();
    expect(store.chatHistory).toEqual([]);
    expect(store.firmwareId).toBeNull();
    expect(store.engramId).toBeNull();
    expect(store.startedAt).toBe(0);
    expect(store.lastTurnAt).toBe(0);
    expect(store.hasPriorSession).toBe(false);
  });

  it("appendTurn updates lastTurnAt and startedAt", async () => {
    const store = useChatStore();
    await store.hydrate();
    expect(store.startedAt).toBe(0);
    const t0 = Date.now();
    store.appendTurn("user", "hi");
    expect(store.startedAt).toBeGreaterThanOrEqual(t0);
    const firstStart = store.startedAt;
    // Second turn advances lastTurnAt but not startedAt.
    await flushMicrotasks();
    store.appendTurn("assistant", "hey");
    expect(store.startedAt).toBe(firstStart);
    expect(store.lastTurnAt).toBeGreaterThanOrEqual(firstStart);
    expect(store.chatHistory).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hey" },
    ]);
  });

  it("persist round-trip through IDB", async () => {
    const store = useChatStore();
    await store.hydrate();
    store.firmwareId = "hermes-8b";
    store.engramId = "johnny";
    store.appendTurn("user", "who are you");
    store.appendTurn("assistant", "samurai.");

    // Wait past the debounce so $subscribe flushes.
    await waitForPersist();

    // Second store instance (fresh pinia, same IDB) should hydrate the record.
    setActivePinia(createPinia());
    const next = useChatStore();
    await next.hydrate();
    expect(next.chatHistory).toEqual([
      { role: "user", content: "who are you" },
      { role: "assistant", content: "samurai." },
    ]);
    expect(next.firmwareId).toBe("hermes-8b");
    expect(next.engramId).toBe("johnny");
    expect(next.hasPriorSession).toBe(true);
  });

  it("schemaVersion mismatch discards, state stays empty, no re-persist", async () => {
    const db = await openSessionDb();
    // fake-indexeddb lets us plant a bogus version.
    await db.put(
      "chat-session",
      {
        schemaVersion: 2,
        chatHistory: [{ role: "user", content: "ghost" }],
        firmwareId: "x",
        engramId: "y",
        startedAt: 1,
        lastTurnAt: 2,
      } as unknown as PersistedChatSession,
      KEY,
    );
    db.close();

    const store = useChatStore();
    await store.hydrate();
    expect(store.chatHistory).toEqual([]);
    expect(store.firmwareId).toBeNull();

    // The stale record should NOT have been overwritten during hydrate.
    const db2 = await openSessionDb();
    const raw = (await db2.get("chat-session", KEY)) as unknown as
      | {
          schemaVersion: number;
        }
      | undefined;
    db2.close();
    expect(raw?.schemaVersion).toBe(2);
  });

  it("clear empties in-memory and deletes IDB record", async () => {
    const store = useChatStore();
    await store.hydrate();
    store.firmwareId = "fw";
    store.engramId = "eg";
    store.appendTurn("user", "x");
    await waitForPersist();

    // Verify the record exists.
    let db = await openSessionDb();
    expect(await db.get("chat-session", KEY)).toBeDefined();
    db.close();

    await store.clear();
    expect(store.chatHistory).toEqual([]);
    expect(store.firmwareId).toBeNull();
    expect(store.engramId).toBeNull();
    expect(store.startedAt).toBe(0);
    expect(store.lastTurnAt).toBe(0);

    db = await openSessionDb();
    expect(await db.get("chat-session", KEY)).toBeUndefined();
    db.close();
  });

  it("summary surfaces handle + turns + timeAgo for a valid prior session", async () => {
    const store = useChatStore();
    await store.hydrate();
    store.firmwareId = "fw";
    store.engramId = "johnny"; // Valid engram id from the catalog.
    store.appendTurn("user", "hey");
    store.appendTurn("assistant", "what");
    store.appendTurn("user", "status");

    expect(store.hasPriorSession).toBe(true);
    const s = store.summary;
    expect(s).not.toBeNull();
    expect(s!.turns).toBe(2); // two user turns
    expect(typeof s!.handle).toBe("string");
    expect(s!.handle.length).toBeGreaterThan(0);
    expect(s!.timeAgo).toMatch(/just now|second|minute|hour|day/);
  });
});
