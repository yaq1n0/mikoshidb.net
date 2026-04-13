import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { createCachedFetcher, evictAll, evictSha, getCacheStats, sweepStale } from "./bundleCache";
import { openCacheDb, type PersistedBundleAsset } from "./db";

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function bytesOf(...xs: number[]): ArrayBuffer {
  return new Uint8Array(xs).buffer;
}

function makeFetchMock(bytes: ArrayBuffer, init?: ResponseInit) {
  return vi.fn(async (_url: string) => new Response(bytes, init));
}

describe("createCachedFetcher", () => {
  it("cache miss → fetches over network, persists to IDB, returns bytes", async () => {
    const sha = "a".repeat(64);
    const payload = bytesOf(1, 2, 3, 4, 5);
    const fetchMock = makeFetchMock(payload);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const fetcher = createCachedFetcher();
    const res = await fetcher("/rag/chunks.bin", sha);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/rag/chunks.bin");

    const gotBytes = new Uint8Array(await res.arrayBuffer());
    expect(gotBytes).toEqual(new Uint8Array([1, 2, 3, 4, 5]));

    const db = await openCacheDb();
    const stored = await db.get("bundle-assets", sha);
    db.close();
    expect(stored).toBeDefined();
    expect(stored!.sizeBytes).toBe(5);
    expect(new Uint8Array(stored!.bytes)).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
    expect(typeof stored!.storedAt).toBe("number");
  });

  it("cache hit → reads from IDB, never calls global fetch", async () => {
    const sha = "b".repeat(64);
    const stored: PersistedBundleAsset = {
      bytes: bytesOf(9, 8, 7),
      storedAt: 42,
      sizeBytes: 3,
    };
    const db = await openCacheDb();
    await db.put("bundle-assets", stored, sha);
    db.close();

    const fetchMock = vi.fn(async () => {
      throw new Error("should not be called");
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const fetcher = createCachedFetcher();
    const res = await fetcher("/rag/chunks.bin", sha);

    expect(fetchMock).not.toHaveBeenCalled();
    const gotBytes = new Uint8Array(await res.arrayBuffer());
    expect(gotBytes).toEqual(new Uint8Array([9, 8, 7]));
  });

  it("empty sha → pass-through, no IDB read or write", async () => {
    const payload = bytesOf(42);
    const fetchMock = makeFetchMock(payload);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const fetcher = createCachedFetcher();
    const res = await fetcher("/rag/manifest.json", "");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/rag/manifest.json");
    const gotBytes = new Uint8Array(await res.arrayBuffer());
    expect(gotBytes).toEqual(new Uint8Array([42]));

    // Nothing should have been cached.
    const db = await openCacheDb();
    const keys = await db.getAllKeys("bundle-assets");
    db.close();
    expect(keys.length).toBe(0);
  });

  it("does not consume the body twice: caller can read returned Response", async () => {
    const sha = "c".repeat(64);
    const payload = bytesOf(11, 22, 33);
    globalThis.fetch = makeFetchMock(payload) as unknown as typeof fetch;

    const fetcher = createCachedFetcher();
    const res = await fetcher("/rag/vec.bin", sha);

    // First and only read of the returned Response body.
    const got = new Uint8Array(await res.arrayBuffer());
    expect(got).toEqual(new Uint8Array([11, 22, 33]));
  });
});

describe("sweepStale", () => {
  it("deletes entries not in keep-set, preserves kept ones, returns count", async () => {
    const shaKeepA = "1".repeat(64);
    const shaKeepB = "2".repeat(64);
    const shaDropC = "3".repeat(64);
    const shaDropD = "4".repeat(64);

    const db = await openCacheDb();
    for (const s of [shaKeepA, shaKeepB, shaDropC, shaDropD]) {
      await db.put("bundle-assets", { bytes: bytesOf(0), storedAt: 0, sizeBytes: 1 }, s);
    }
    db.close();

    const deleted = await sweepStale(new Set([shaKeepA, shaKeepB]));
    expect(deleted).toBe(2);

    const db2 = await openCacheDb();
    const remaining = await db2.getAllKeys("bundle-assets");
    db2.close();
    expect([...remaining].sort()).toEqual([shaKeepA, shaKeepB].sort());
  });

  it("returns 0 when nothing to sweep", async () => {
    const deleted = await sweepStale(new Set());
    expect(deleted).toBe(0);
  });
});

describe("helpers", () => {
  it("getCacheStats aggregates count and sizeBytes", async () => {
    const db = await openCacheDb();
    await db.put(
      "bundle-assets",
      { bytes: bytesOf(1, 2), storedAt: 0, sizeBytes: 2 },
      "x".repeat(64),
    );
    await db.put(
      "bundle-assets",
      { bytes: bytesOf(1, 2, 3, 4), storedAt: 0, sizeBytes: 4 },
      "y".repeat(64),
    );
    db.close();

    const stats = await getCacheStats();
    expect(stats.count).toBe(2);
    expect(stats.sizeBytes).toBe(6);
  });

  it("evictAll clears every entry", async () => {
    const db = await openCacheDb();
    await db.put("bundle-assets", { bytes: bytesOf(1), storedAt: 0, sizeBytes: 1 }, "z".repeat(64));
    db.close();

    await evictAll();

    const stats = await getCacheStats();
    expect(stats.count).toBe(0);
  });

  it("evictSha removes a single entry", async () => {
    const keep = "k".repeat(64);
    const drop = "d".repeat(64);
    const db = await openCacheDb();
    await db.put("bundle-assets", { bytes: bytesOf(1), storedAt: 0, sizeBytes: 1 }, keep);
    await db.put("bundle-assets", { bytes: bytesOf(2), storedAt: 0, sizeBytes: 1 }, drop);
    db.close();

    await evictSha(drop);

    const db2 = await openCacheDb();
    const keys = await db2.getAllKeys("bundle-assets");
    db2.close();
    expect([...keys]).toEqual([keep]);
  });
});
