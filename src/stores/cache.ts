import { defineStore } from "pinia";
import { ref } from "vue";
import {
  getWebLLMStats,
  evictAllWebLLM,
  evictWebLLMModel,
  type WebLLMStats,
} from "@/cache/webllmInspector";
import {
  getBundleStats,
  evictAllBundle,
  evictStaleBundle,
  type BundleStats,
} from "@/cache/bundleInspector";
import { ragRef } from "@/terminal/session";

export interface StorageEstimate {
  usage?: number;
  quota?: number;
}

/**
 * Cache store — stats + eviction across WebLLM and the opensona bundle cache.
 * Derived on demand, no persistence.
 */
export const useCacheStore = defineStore("cache", () => {
  const webllm = ref<WebLLMStats | null>(null);
  const bundle = ref<BundleStats | null>(null);
  const storageEstimate = ref<StorageEstimate | null>(null);
  const loading = ref<boolean>(false);
  const lastRefreshedAt = ref<number | null>(null);

  async function refresh(): Promise<void> {
    loading.value = true;
    try {
      const tasks: [Promise<WebLLMStats>, Promise<BundleStats>, Promise<StorageEstimate | null>] = [
        getWebLLMStats().catch(() => ({ caches: [], entries: 0, estSizeBytes: 0 })),
        getBundleStats().catch(() => ({ count: 0, sizeBytes: 0 })),
        navigator?.storage?.estimate
          ? navigator.storage.estimate().catch(() => null)
          : Promise.resolve(null),
      ];
      const [w, b, est] = await Promise.all(tasks);
      webllm.value = w;
      bundle.value = b;
      storageEstimate.value = est ?? null;
      lastRefreshedAt.value = Date.now();
    } finally {
      loading.value = false;
    }
  }

  async function evictWebLLM(modelId?: string): Promise<void> {
    if (modelId) await evictWebLLMModel(modelId);
    else await evictAllWebLLM();
    await refresh();
  }

  async function evictBundleAll(): Promise<void> {
    await evictAllBundle();
    await refresh();
  }

  /**
   * Sweep bundle assets whose sha is not referenced by the currently loaded
   * runtime's manifest. No-op if there's no active runtime.
   */
  async function evictBundleStale(): Promise<number> {
    const manifest = ragRef.value?.manifest();
    if (!manifest) return 0;
    const keepShas = new Set<string>(
      Object.values(manifest.files)
        .map((f) => f.sha256)
        .filter(Boolean),
    );
    const deleted = await evictStaleBundle(keepShas);
    await refresh();
    return deleted;
  }

  return {
    webllm,
    bundle,
    storageEstimate,
    loading,
    lastRefreshedAt,
    refresh,
    evictWebLLM,
    evictBundleAll,
    evictBundleStale,
  };
});
