// Bundle cache inspector — thin wrapper over `src/storage/bundleCache.ts`.
//
// Exists to give the Cache debug tab a single import surface alongside the
// WebLLM and Transformers inspectors, and to add the `evictStale(keepShas)`
// convenience that the tab calls when the user clicks "evict stale".

import {
  evictAll as bundleEvictAll,
  getCacheStats as bundleGetStats,
  sweepStale,
  type CacheStats,
} from "@/storage/bundleCache";

export type BundleStats = CacheStats;

export const getBundleStats = async (): Promise<BundleStats> => {
  return bundleGetStats();
};

export const evictAllBundle = async (): Promise<void> => {
  return bundleEvictAll();
};

/**
 * Delete every bundle-asset whose sha is not in `keepShas`. Delegates to
 * `sweepStale` from `bundleCache.ts`. Returns the number of entries deleted.
 *
 * Caller is responsible for sourcing `keepShas` — typically the sha set
 * extracted from the active runtime's `manifest().files[*].sha256`.
 */
export const evictStaleBundle = async (keepShas: Set<string>): Promise<number> => {
  return sweepStale(keepShas);
};
