// WebLLM cache inspector — visibility + eviction over the `webllm/*`
// cache layers managed by `@mlc-ai/web-llm`.
//
// WebLLM stashes model artifacts under three CacheStorage names:
//   - `webllm/wasm`   (TVM runtime modules)
//   - `webllm/config` (mlc-chat-config.json etc.)
//   - `webllm/model`  (sharded weight tensors)
//
// We can't enumerate "models" cleanly without the appConfig (which ties
// model_id → model_url), so we expose a pragmatic two-track surface:
//   1. `getWebLLMStats()` — best-effort listing of the webllm-prefixed
//      caches and a rough sizeBytes estimate via Content-Length headers.
//   2. `evictWebLLMModel(modelId)` — uses the official
//      `deleteModelAllInfoInCache(modelId)` export to wipe one model's
//      shards/config/wasm via the prebuilt appConfig WebLLM ships with.
//   3. `evictAllWebLLM()` — nukes every `webllm/*` CacheStorage entirely.
//      Safer/cheaper than enumerating model_ids when the user just wants
//      to free space.

const WEBLLM_CACHE_PREFIX = "webllm/";

export type WebLLMStats = {
  /** CacheStorage names matching `webllm/*`. */
  caches: string[];
  /** Total entry count across all webllm caches. */
  entries: number;
  /** Best-effort size from `Content-Length` headers. May be 0 if headers absent. */
  estSizeBytes: number;
};

const isCacheStorageAvailable = (): boolean => {
  return typeof caches !== "undefined" && typeof caches.keys === "function";
};

export const getWebLLMStats = async (): Promise<WebLLMStats> => {
  if (!isCacheStorageAvailable()) {
    return { caches: [], entries: 0, estSizeBytes: 0 };
  }

  const allKeys = await caches.keys();
  const webllmKeys = allKeys.filter((k) => k.startsWith(WEBLLM_CACHE_PREFIX));

  let entries = 0;
  let estSizeBytes = 0;

  for (const cacheName of webllmKeys) {
    try {
      const cache = await caches.open(cacheName);
      const reqs = await cache.keys();
      entries += reqs.length;
      // Best-effort size: peek at each cached Response's Content-Length.
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
          // Ignore per-entry failures — keep aggregating.
        }
      }
    } catch {
      // Ignore per-cache failures — cache may have been evicted mid-scan.
    }
  }

  return { caches: webllmKeys, entries, estSizeBytes };
};

/**
 * Evict every artifact for a given WebLLM modelId. Uses the official
 * `deleteModelAllInfoInCache` from `@mlc-ai/web-llm`, which honors
 * `prebuiltAppConfig` to resolve the model URL → cache keys.
 */
export const evictWebLLMModel = async (modelId: string): Promise<void> => {
  const { deleteModelAllInfoInCache } = await import("@mlc-ai/web-llm");
  await deleteModelAllInfoInCache(modelId);
};

/**
 * Bulk-delete every `webllm/*` CacheStorage. Returns the number of caches
 * deleted. Pragmatic when the user wants a fresh slate without knowing
 * exact model_ids.
 *
 * Caveat: WebLLM may also stash artifacts in an IndexedDB cache
 * (`ArtifactIndexedDBCache`) when `useIndexedDBCache: true`. This bulk
 * delete only covers the CacheStorage path. For full coverage, pair with
 * `evictWebLLMModel(modelId)` which respects both.
 */
export const evictAllWebLLM = async (): Promise<number> => {
  if (!isCacheStorageAvailable()) return 0;
  const allKeys = await caches.keys();
  const webllmKeys = allKeys.filter((k) => k.startsWith(WEBLLM_CACHE_PREFIX));
  let deleted = 0;
  for (const cacheName of webllmKeys) {
    try {
      const ok = await caches.delete(cacheName);
      if (ok) deleted++;
    } catch {
      // Ignore individual failures; report best-effort count.
    }
  }
  return deleted;
};
