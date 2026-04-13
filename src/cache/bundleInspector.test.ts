import { beforeEach, describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { evictAllBundle, evictStaleBundle, getBundleStats } from "./bundleInspector";
import { openCacheDb } from "@/storage/db";

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

/** Bytes of. */
const bytesOf = (...xs: number[]): ArrayBuffer => {
  return new Uint8Array(xs).buffer;
};

describe("bundleInspector", () => {
  it("evictStaleBundle delegates to sweepStale: drops shas not in keep-set", async () => {
    const keep = "k".repeat(64);
    const drop = "d".repeat(64);

    const db = await openCacheDb();
    await db.put("bundle-assets", { bytes: bytesOf(1, 2), storedAt: 0, sizeBytes: 2 }, keep);
    await db.put("bundle-assets", { bytes: bytesOf(3, 4), storedAt: 0, sizeBytes: 2 }, drop);
    db.close();

    const deleted = await evictStaleBundle(new Set([keep]));
    expect(deleted).toBe(1);

    const stats = await getBundleStats();
    expect(stats.count).toBe(1);
    expect(stats.sizeBytes).toBe(2);
  });

  it("evictAllBundle clears every entry", async () => {
    const db = await openCacheDb();
    await db.put("bundle-assets", { bytes: bytesOf(1), storedAt: 0, sizeBytes: 1 }, "x".repeat(64));
    db.close();

    await evictAllBundle();

    const stats = await getBundleStats();
    expect(stats.count).toBe(0);
    expect(stats.sizeBytes).toBe(0);
  });
});
