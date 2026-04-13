// Transformers.js cache inspector — visibility + bulk eviction over the
// `transformers-cache` CacheStorage that `@huggingface/transformers`
// populates when caching model assets in the browser.
//
// Confirmed cache name: `transformers-cache` (see the `caches.open` call
// in `@huggingface/transformers/src/utils/hub.js`).

const TRANSFORMERS_CACHE_NAME = "transformers-cache";

export interface TransformersStats {
  /** Number of cached request entries. */
  entries: number;
  /** Best-effort size from `Content-Length` headers. May be 0 if absent. */
  estSizeBytes: number;
}

function isCacheStorageAvailable(): boolean {
  return typeof caches !== "undefined" && typeof caches.open === "function";
}

export async function getTransformersStats(): Promise<TransformersStats> {
  if (!isCacheStorageAvailable()) {
    return { entries: 0, estSizeBytes: 0 };
  }

  // `caches.has` would short-circuit nicely but isn't universally available;
  // `caches.open` will create-if-missing, so guard with `caches.keys()` first
  // to avoid materializing an empty cache as a side effect.
  const allKeys = await caches.keys();
  if (!allKeys.includes(TRANSFORMERS_CACHE_NAME)) {
    return { entries: 0, estSizeBytes: 0 };
  }

  let entries = 0;
  let estSizeBytes = 0;
  try {
    const cache = await caches.open(TRANSFORMERS_CACHE_NAME);
    const reqs = await cache.keys();
    entries = reqs.length;
    for (const req of reqs) {
      try {
        const res = await cache.match(req);
        if (!res) continue;
        const len = res.headers.get("content-length");
        if (len) {
          const n = Number(len);
          if (Number.isFinite(n)) estSizeBytes += n;
        }
      } catch {
        // Skip per-entry failures.
      }
    }
  } catch {
    // Cache disappeared between keys() and open() — treat as empty.
  }

  return { entries, estSizeBytes };
}

/**
 * Wipe the entire `transformers-cache`. Returns 1 if a cache was deleted,
 * 0 if there was nothing to delete.
 */
export async function evictAllTransformers(): Promise<number> {
  if (!isCacheStorageAvailable()) return 0;
  try {
    const ok = await caches.delete(TRANSFORMERS_CACHE_NAME);
    return ok ? 1 : 0;
  } catch {
    return 0;
  }
}
