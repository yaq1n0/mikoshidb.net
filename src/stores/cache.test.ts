import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { IDBFactory } from "fake-indexeddb";
import { useCacheStore } from "@/stores/cache";
import { openCacheDb, type PersistedBundleAsset } from "@/storage/db";
import { ragRef } from "@/terminal/session";

type CacheLayout = Record<string, { url: string; contentLength?: string }[]>;

const installCachesShim = (layout: CacheLayout): void => {
  const shim = {
    keys: async (): Promise<string[]> => Object.keys(layout),
    open: async (name: string) => ({
      keys: async () => (layout[name] ?? []).map((e) => ({ url: e.url })),
      match: async (req: { url: string }) => {
        const entry = (layout[name] ?? []).find((e) => e.url === req.url);
        if (!entry) return undefined;
        return {
          headers: {
            get: (h: string) =>
              h.toLowerCase() === "content-length" ? (entry.contentLength ?? null) : null,
          },
        };
      },
    }),
    delete: vi.fn(async () => true),
  };
  (globalThis as unknown as { caches: unknown }).caches = shim;
};

const installNavigator = (estimate?: () => Promise<{ usage?: number; quota?: number }>): void => {
  Object.defineProperty(globalThis, "navigator", {
    value: estimate ? { storage: { estimate } } : {},
    configurable: true,
    writable: true,
  });
};

const clearGlobals = (): void => {
  delete (globalThis as unknown as { caches?: unknown }).caches;
  Object.defineProperty(globalThis, "navigator", {
    value: undefined,
    configurable: true,
    writable: true,
  });
};

const seedBundleAsset = async (sha: string, sizeBytes: number): Promise<void> => {
  const db = await openCacheDb();
  const asset: PersistedBundleAsset = {
    bytes: new ArrayBuffer(sizeBytes),
    storedAt: Date.now(),
    sizeBytes,
  };
  await db.put("bundle-assets", asset, sha);
  db.close();
};

describe("useCacheStore", () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    setActivePinia(createPinia());
    ragRef.value = null;
  });

  afterEach(() => {
    clearGlobals();
    ragRef.value = null;
  });

  it("refresh populates webllm, bundle, storageEstimate, lastRefreshedAt", async () => {
    installCachesShim({
      "webllm/model": [{ url: "https://x/m1", contentLength: "200" }],
    });
    installNavigator(async () => ({ usage: 1000, quota: 9000 }));
    await seedBundleAsset("sha-a", 111);

    const store = useCacheStore();
    expect(store.loading).toBe(false);
    const pending = store.refresh();
    expect(store.loading).toBe(true);
    await pending;

    expect(store.loading).toBe(false);
    expect(store.webllm).toEqual({
      caches: ["webllm/model"],
      entries: 1,
      estSizeBytes: 200,
    });
    expect(store.bundle?.count).toBe(1);
    expect(store.bundle?.sizeBytes).toBe(111);
    expect(store.storageEstimate).toEqual({ usage: 1000, quota: 9000 });
    expect(typeof store.lastRefreshedAt).toBe("number");
  });

  it("refresh swallows inspector errors and still sets lastRefreshedAt", async () => {
    // No caches shim → getWebLLMStats returns zeros (caught path).
    // No navigator.storage → storageEstimate stays null.
    installNavigator();
    const store = useCacheStore();
    await store.refresh();
    expect(store.webllm).toEqual({ caches: [], entries: 0, estSizeBytes: 0 });
    expect(store.storageEstimate).toBeNull();
    expect(typeof store.lastRefreshedAt).toBe("number");
  });

  it("evictBundleAll clears the bundle-assets store and refreshes", async () => {
    installNavigator();
    await seedBundleAsset("sha-a", 10);
    await seedBundleAsset("sha-b", 20);

    const store = useCacheStore();
    await store.evictBundleAll();
    expect(store.bundle?.count).toBe(0);
    expect(store.bundle?.sizeBytes).toBe(0);
  });

  it("evictBundleStale returns 0 when no active runtime is loaded", async () => {
    installNavigator();
    const store = useCacheStore();
    expect(await store.evictBundleStale()).toBe(0);
  });

  it("evictBundleStale preserves shas referenced by the runtime manifest", async () => {
    installNavigator();
    await seedBundleAsset("keep-me", 10);
    await seedBundleAsset("stale-1", 20);
    await seedBundleAsset("stale-2", 30);

    // Minimal stub runtime exposing only `manifest()` — enough for cache.ts.
    ragRef.value = {
      manifest: () => ({
        files: { "a.bin": { sha256: "keep-me" } },
      }),
    } as unknown as typeof ragRef.value;

    const store = useCacheStore();
    const deleted = await store.evictBundleStale();
    expect(deleted).toBe(2);
    expect(store.bundle?.count).toBe(1);
  });
});
