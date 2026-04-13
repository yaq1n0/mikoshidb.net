<script setup lang="ts">
import { computed, onMounted } from "vue";
import { useCacheStore } from "@/stores/cache";
import { ragRef } from "@/terminal/session";

const cache = useCacheStore();

const cacheApiAvailable = typeof caches !== "undefined" && typeof caches.open === "function";
const storageEstimateAvailable =
  typeof navigator !== "undefined" &&
  typeof navigator.storage !== "undefined" &&
  typeof navigator.storage?.estimate === "function";

const ragLoaded = computed<boolean>(() => ragRef.value !== null);

const usagePercent = computed<number | null>(() => {
  const est = cache.storageEstimate;
  if (!est || !est.usage || !est.quota) return null;
  return (est.usage / est.quota) * 100;
});

const fmtBytes = (n: number | null | undefined): string => {
  if (n === null || n === undefined || !Number.isFinite(n)) return "?";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${units[i]}`;
};

const fmtTime = (ts: number | null): string => {
  if (!ts) return "(never)";
  return new Date(ts).toLocaleTimeString(undefined, { hour12: false });
};

const onRefresh = async (): Promise<void> => {
  await cache.refresh();
};

const onEvictWebLLM = async (): Promise<void> => {
  if (!confirm("Evict ALL WebLLM caches? Models will redownload on next firmware load.")) return;
  await cache.evictWebLLM();
};

const onEvictBundleAll = async (): Promise<void> => {
  if (!confirm("Evict ALL bundle-cache assets? Engram bundle will redownload on next jack-in.")) {
    return;
  }
  await cache.evictBundleAll();
};

const onEvictBundleStale = async (): Promise<void> => {
  if (!ragLoaded.value) return;
  if (!confirm("Evict bundle assets not referenced by the currently loaded runtime?")) return;
  await cache.evictBundleStale();
};

onMounted(() => {
  if (cacheApiAvailable && cache.lastRefreshedAt === null) {
    void cache.refresh();
  }
});
</script>

<template>
  <div class="h-full flex flex-col">
    <!-- Toolbar -->
    <div class="flex items-center justify-between px-3 py-2 border-b border-dim shrink-0 gap-2">
      <span class="text-xs text-dim">
        cache inspector
        <span v-if="cache.lastRefreshedAt !== null" class="ml-1">
          · refreshed {{ fmtTime(cache.lastRefreshedAt) }}
        </span>
      </span>
      <button
        class="text-xs px-2 py-0.5 border border-dim rounded text-dim hover:text-fg hover:border-fg cursor-pointer disabled:opacity-50"
        :disabled="cache.loading || !cacheApiAvailable"
        title="Re-read all cache stats"
        @click="onRefresh"
      >
        {{ cache.loading ? "..." : "refresh" }}
      </button>
    </div>

    <div class="flex-1 overflow-y-auto px-3 py-2 space-y-3 text-xs">
      <!-- Feature-detect bail-out -->
      <div v-if="!cacheApiAvailable" class="border border-dim rounded px-2 py-2 text-dim italic">
        cache API unavailable in this browser
      </div>

      <template v-else>
        <!-- Storage budget -->
        <section class="border border-dim rounded">
          <div class="px-2 py-1 border-b border-dim text-accent font-bold">storage budget</div>
          <div class="px-2 py-1.5 space-y-0.5">
            <template v-if="storageEstimateAvailable && cache.storageEstimate">
              <div>
                <span class="text-dim">used: </span>
                <span class="text-fg">{{ fmtBytes(cache.storageEstimate.usage) }}</span>
              </div>
              <div>
                <span class="text-dim">quota: </span>
                <span class="text-fg">{{ fmtBytes(cache.storageEstimate.quota) }}</span>
              </div>
              <div v-if="usagePercent !== null">
                <span class="text-dim">utilization: </span>
                <span class="text-accent">{{ usagePercent.toFixed(2) }}%</span>
              </div>
            </template>
            <div v-else-if="!storageEstimateAvailable" class="text-dim italic">
              navigator.storage.estimate unavailable
            </div>
            <div v-else class="text-dim italic">no data — click refresh</div>
          </div>
        </section>

        <!-- WebLLM -->
        <section class="border border-dim rounded">
          <div class="flex items-center justify-between px-2 py-1 border-b border-dim">
            <span class="text-accent font-bold">webllm</span>
            <button
              class="text-xs px-2 py-0.5 border border-dim rounded text-dim hover:text-danger hover:border-danger cursor-pointer disabled:opacity-50"
              :disabled="cache.loading"
              @click="onEvictWebLLM"
            >
              evict all
            </button>
          </div>
          <div class="px-2 py-1.5 space-y-0.5">
            <template v-if="cache.webllm">
              <div>
                <span class="text-dim">caches: </span>
                <span class="text-fg break-all">
                  {{ cache.webllm.caches.length === 0 ? "(none)" : cache.webllm.caches.join(", ") }}
                </span>
              </div>
              <div>
                <span class="text-dim">entries: </span>
                <span class="text-fg">{{ cache.webllm.entries }}</span>
              </div>
              <div>
                <span class="text-dim">est size: </span>
                <span class="text-fg">{{ fmtBytes(cache.webllm.estSizeBytes) }}</span>
                <span
                  v-if="cache.webllm.estSizeBytes === 0 && cache.webllm.entries > 0"
                  class="text-dim ml-1"
                  >(no Content-Length headers)</span
                >
              </div>
            </template>
            <div v-else class="text-dim italic">no data — click refresh</div>
          </div>
        </section>

        <!-- Bundle -->
        <section class="border border-dim rounded">
          <div class="flex items-center justify-between px-2 py-1 border-b border-dim gap-2">
            <span class="text-accent font-bold">bundle</span>
            <div class="flex items-center gap-1">
              <button
                class="text-xs px-2 py-0.5 border border-dim rounded text-dim hover:text-fg hover:border-fg cursor-pointer disabled:opacity-50"
                :disabled="cache.loading || !ragLoaded"
                :title="
                  ragLoaded
                    ? 'Sweep entries not referenced by current runtime'
                    : 'no runtime loaded — load firmware + jack-in first'
                "
                @click="onEvictBundleStale"
              >
                evict stale
              </button>
              <button
                class="text-xs px-2 py-0.5 border border-dim rounded text-dim hover:text-danger hover:border-danger cursor-pointer disabled:opacity-50"
                :disabled="cache.loading"
                @click="onEvictBundleAll"
              >
                evict all
              </button>
            </div>
          </div>
          <div class="px-2 py-1.5 space-y-0.5">
            <template v-if="cache.bundle">
              <div>
                <span class="text-dim">store: </span>
                <span class="text-fg">bundle-assets (idb)</span>
              </div>
              <div>
                <span class="text-dim">entries: </span>
                <span class="text-fg">{{ cache.bundle.count }}</span>
              </div>
              <div>
                <span class="text-dim">size: </span>
                <span class="text-fg">{{ fmtBytes(cache.bundle.sizeBytes) }}</span>
              </div>
            </template>
            <div v-else class="text-dim italic">no data — click refresh</div>
          </div>
        </section>
      </template>
    </div>
  </div>
</template>
