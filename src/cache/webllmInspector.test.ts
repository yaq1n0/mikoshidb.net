import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { evictAllWebLLM, getWebLLMStats } from "@/cache/webllmInspector";

type CacheEntry = { url: string; contentLength?: string };

/** Build a minimal CacheStorage shim over an in-memory map of cache → entries. */
const installCachesShim = (layout: Record<string, CacheEntry[]>) => {
  const deleted = new Set<string>();
  const deleteSpy = vi.fn(async (name: string) => {
    if (deleted.has(name)) return false;
    if (!(name in layout)) return false;
    deleted.add(name);
    return true;
  });
  const shim = {
    keys: async (): Promise<string[]> => Object.keys(layout).filter((k) => !deleted.has(k)),
    open: async (name: string) => {
      const entries = layout[name] ?? [];
      return {
        keys: async () => entries.map((e) => ({ url: e.url })),
        match: async (req: { url: string }) => {
          const entry = entries.find((e) => e.url === req.url);
          if (!entry) return undefined;
          return {
            headers: {
              get: (h: string) =>
                h.toLowerCase() === "content-length" ? (entry.contentLength ?? null) : null,
            },
          };
        },
      };
    },
    delete: deleteSpy,
  };
  (globalThis as unknown as { caches: unknown }).caches = shim;
  return { deleteSpy };
};

const clearCachesShim = (): void => {
  delete (globalThis as unknown as { caches?: unknown }).caches;
};

describe("getWebLLMStats", () => {
  afterEach(() => clearCachesShim());

  it("returns zero stats when CacheStorage is unavailable", async () => {
    clearCachesShim();
    expect(await getWebLLMStats()).toEqual({
      caches: [],
      entries: 0,
      estSizeBytes: 0,
    });
  });

  it("filters to webllm/* and aggregates entry counts + content-length", async () => {
    installCachesShim({
      "webllm/model": [
        { url: "https://x/m1", contentLength: "100" },
        { url: "https://x/m2", contentLength: "250" },
      ],
      "webllm/config": [{ url: "https://x/c1", contentLength: "50" }],
      "other/cache": [{ url: "https://x/o1", contentLength: "999" }],
    });
    const stats = await getWebLLMStats();
    expect(stats.caches.sort()).toEqual(["webllm/config", "webllm/model"]);
    expect(stats.entries).toBe(3);
    expect(stats.estSizeBytes).toBe(400);
  });

  it("handles missing Content-Length headers", async () => {
    installCachesShim({
      "webllm/model": [{ url: "https://x/m1" }],
    });
    const stats = await getWebLLMStats();
    expect(stats.entries).toBe(1);
    expect(stats.estSizeBytes).toBe(0);
  });
});

describe("evictAllWebLLM", () => {
  afterEach(() => clearCachesShim());

  it("returns 0 when CacheStorage is unavailable", async () => {
    clearCachesShim();
    expect(await evictAllWebLLM()).toBe(0);
  });

  it("deletes only webllm/* caches and returns the deletion count", async () => {
    const { deleteSpy } = installCachesShim({
      "webllm/model": [],
      "webllm/config": [],
      "other/cache": [],
    });
    const deleted = await evictAllWebLLM();
    expect(deleted).toBe(2);
    const calls = deleteSpy.mock.calls.map((c) => c[0]).sort();
    expect(calls).toEqual(["webllm/config", "webllm/model"]);
  });
});

describe("getWebLLMStats (stub reset between suites)", () => {
  beforeEach(() => clearCachesShim());
  it("resets cleanly between tests", async () => {
    expect(await getWebLLMStats()).toEqual({
      caches: [],
      entries: 0,
      estSizeBytes: 0,
    });
  });
});
