// App-owned cache-aware fetcher for opensona bundle assets.
//
// opensona stays caching-agnostic: the app injects a `fetchOverride` that
// consults IndexedDB (the `bundle-assets` store in the cache DB) keyed by
// sha256. The manifest.json itself is fetched with an empty-string sha —
// that's a pass-through signal, not a cache key, because the manifest's own
// sha is the source of truth and caching it would be a chicken-and-egg.

import { openCacheDb, type PersistedBundleAsset } from "./db";

export type FetchOverride = (url: string, expectedSha256: string) => Promise<Response>;

/**
 * Returns a `fetchOverride` closure compatible with opensona's
 * `EnsureLoadedOptions.fetchOverride`. Honors an IndexedDB-backed cache
 * keyed by sha256.
 *
 * Empty/falsy sha → direct pass-through to `fetch(url)` (no read/write).
 */
export function createCachedFetcher(): FetchOverride {
  return async function cachedFetch(url: string, expectedSha256: string): Promise<Response> {
    if (!expectedSha256) {
      // No integrity hint — don't touch the cache, just fetch.
      return fetch(url);
    }

    // Cache read.
    try {
      const db = await openCacheDb();
      const hit = await db.get("bundle-assets", expectedSha256);
      db.close();
      if (hit && hit.bytes) {
        return new Response(hit.bytes, {
          headers: { "Content-Type": "application/octet-stream" },
        });
      }
    } catch {
      // IDB errors shouldn't take down asset loading; fall through to network.
    }

    // Cache miss → network fetch, then persist.
    const response = await fetch(url);
    if (!response.ok) {
      // Propagate failure to the caller; don't poison the cache.
      return response;
    }

    // Read the body once into an ArrayBuffer. We return a brand-new Response
    // from the same bytes so the caller (opensona loader) sees an unconsumed
    // body regardless of whether we wrote to IDB.
    const bytes = await response.arrayBuffer();

    try {
      const db = await openCacheDb();
      const asset: PersistedBundleAsset = {
        bytes,
        storedAt: Date.now(),
        sizeBytes: bytes.byteLength,
      };
      await db.put("bundle-assets", asset, expectedSha256);
      db.close();
    } catch {
      // Storage failure is non-fatal — caller still gets a working response.
    }

    return new Response(bytes, {
      headers: { "Content-Type": "application/octet-stream" },
    });
  };
}

/**
 * Delete every bundle-asset whose sha is not in `keepShas`. Returns the
 * number of entries deleted. Safe to call in the background after a
 * successful load.
 */
export async function sweepStale(keepShas: Set<string>): Promise<number> {
  const db = await openCacheDb();
  try {
    const keys = await db.getAllKeys("bundle-assets");
    let deleted = 0;
    for (const key of keys) {
      if (!keepShas.has(key)) {
        await db.delete("bundle-assets", key);
        deleted++;
      }
    }
    return deleted;
  } finally {
    db.close();
  }
}

export type CacheStats = {
  count: number;
  sizeBytes: number;
};

/** Lightweight aggregate over the bundle-assets store. */
export async function getCacheStats(): Promise<CacheStats> {
  const db = await openCacheDb();
  try {
    const entries = await db.getAll("bundle-assets");
    let sizeBytes = 0;
    for (const e of entries) sizeBytes += e.sizeBytes ?? 0;
    return { count: entries.length, sizeBytes };
  } finally {
    db.close();
  }
}

/** Wipe the entire bundle cache. */
export async function evictAll(): Promise<void> {
  const db = await openCacheDb();
  try {
    await db.clear("bundle-assets");
  } finally {
    db.close();
  }
}

/** Evict a single sha. Silent if the key is absent. */
export async function evictSha(sha: string): Promise<void> {
  const db = await openCacheDb();
  try {
    await db.delete("bundle-assets", sha);
  } finally {
    db.close();
  }
}
