import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import {
  CACHE_DB_NAME,
  DB_SCHEMA_VERSION,
  SESSION_DB_NAME,
  openCacheDb,
  openSessionDb,
  type PersistedBundleAsset,
  type PersistedChatSession,
  type PersistedRagEntry,
  type PersistedScrollbackLine,
} from "./db";

beforeEach(() => {
  // Fresh in-memory IDB per test.
  globalThis.indexedDB = new IDBFactory();
});

afterEach(async () => {
  // Best-effort cleanup; the next beforeEach replaces the factory regardless.
});

describe("session db", () => {
  it("scrollback: auto-incs id, round-trips fields, indexes by timestamp", async () => {
    const db = await openSessionDb();
    expect(db.version).toBe(DB_SCHEMA_VERSION);

    const line: PersistedScrollbackLine = {
      schemaVersion: 1,
      kind: "out",
      text: "hello world",
      progress: 1,
      timestamp: 1_700_000_000_000,
    };
    const id = await db.add("scrollback", line);
    expect(typeof id).toBe("number");
    expect(id).toBe(1);

    const second: PersistedScrollbackLine = {
      schemaVersion: 1,
      kind: "in",
      text: "next",
      timestamp: 1_700_000_000_500,
    };
    const id2 = await db.add("scrollback", second);
    expect(id2).toBe(2);

    const got = await db.get("scrollback", id);
    expect(got).toMatchObject({
      id: 1,
      schemaVersion: 1,
      kind: "out",
      text: "hello world",
      progress: 1,
      timestamp: 1_700_000_000_000,
    });

    // by-timestamp index
    const byTs = await db.getAllFromIndex("scrollback", "by-timestamp");
    expect(byTs.map((r) => r.timestamp)).toEqual([1_700_000_000_000, 1_700_000_000_500]);

    db.close();
  });

  it("chat-session: write/read/overwrite under key 'current'", async () => {
    const db = await openSessionDb();

    const initial: PersistedChatSession = {
      schemaVersion: 1,
      chatHistory: [{ role: "user", content: "hi" }],
      firmwareId: "fw-1",
      engramId: "eg-1",
      startedAt: 1,
      lastTurnAt: 2,
    };
    await db.put("chat-session", initial, "current");

    const read = await db.get("chat-session", "current");
    expect(read).toEqual(initial);

    const updated: PersistedChatSession = {
      ...initial,
      chatHistory: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
      ],
      lastTurnAt: 3,
    };
    await db.put("chat-session", updated, "current");

    const reread = await db.get("chat-session", "current");
    expect(reread?.chatHistory.length).toBe(2);
    expect(reread?.lastTurnAt).toBe(3);

    db.close();
  });

  it("rag-log: append two entries, iterate in insertion order", async () => {
    const db = await openSessionDb();

    const a: PersistedRagEntry = {
      schemaVersion: 1,
      query: "q1",
      response: "r1",
      timestamp: 100,
    };
    const b: PersistedRagEntry = {
      schemaVersion: 1,
      query: "q2",
      response: "r2",
      timestamp: 200,
    };

    const idA = await db.add("rag-log", a);
    const idB = await db.add("rag-log", b);
    expect(idA).toBe(1);
    expect(idB).toBe(2);

    const all = await db.getAll("rag-log");
    expect(all.map((r) => r.id)).toEqual([1, 2]);
    expect(all.map((r) => r.query)).toEqual(["q1", "q2"]);

    db.close();
  });

  it("session db has expected version + store names", async () => {
    const db = await openSessionDb();
    expect(db.name).toBe(SESSION_DB_NAME);
    expect(db.version).toBe(1);
    expect([...db.objectStoreNames].sort()).toEqual(["chat-session", "rag-log", "scrollback"]);
    db.close();
  });
});

describe("cache db", () => {
  it("bundle-assets: put/get/delete by sha256 key", async () => {
    const db = await openCacheDb();
    expect(db.name).toBe(CACHE_DB_NAME);
    expect(db.version).toBe(1);
    expect([...db.objectStoreNames]).toEqual(["bundle-assets"]);

    const sha = "a".repeat(64);
    const bytes = new Uint8Array([1, 2, 3, 4]).buffer;
    const asset: PersistedBundleAsset = {
      bytes,
      storedAt: 1_700_000_000_000,
      sizeBytes: 4,
    };

    await db.put("bundle-assets", asset, sha);

    const got = await db.get("bundle-assets", sha);
    expect(got).toBeDefined();
    expect(got?.sizeBytes).toBe(4);
    expect(new Uint8Array(got!.bytes)).toEqual(new Uint8Array([1, 2, 3, 4]));

    await db.delete("bundle-assets", sha);
    const gone = await db.get("bundle-assets", sha);
    expect(gone).toBeUndefined();

    db.close();
  });
});
