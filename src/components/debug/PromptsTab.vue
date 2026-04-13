<script setup lang="ts">
import { computed } from "vue";
import { useRagStore } from "@/stores/rag";
import { useDebugStore } from "@/stores/debug";

const debug = useDebugStore();
const ragStore = useRagStore();

const entries = computed(() => ragStore.ragLog);

const fmtTime = (ts: number): string => {
  const d = new Date(ts);
  return d.toLocaleTimeString(undefined, { hour12: false });
};

/** Max bar width in px for the timing breakdown rows. */
const BAR_MAX_PX = 120;

const maxTimingMs = (timing: Record<string, number>): number => {
  let m = 0;
  for (const v of Object.values(timing)) if (v > m) m = v;
  return m || 1; // avoid div-by-zero — empty/zeroed timing collapses to a 1px bar
};

const barWidthPx = (value: number, max: number): number => {
  return Math.max(2, Math.round((value / max) * BAR_MAX_PX));
};
</script>

<template>
  <div class="h-full flex flex-col">
    <div class="px-3 py-2 border-b border-dim text-xs text-dim shrink-0">
      preamble + system prompt + timing per turn
    </div>

    <div class="flex-1 overflow-y-auto px-3 py-2 space-y-2">
      <div v-if="entries.length === 0" class="text-dim text-xs italic py-4">No prompt data</div>

      <div v-for="entry in entries" :key="entry.id" class="border border-dim rounded">
        <div class="px-2 py-1.5 border-b border-dim flex items-baseline gap-2 text-xs">
          <span class="text-dim">{{ fmtTime(entry.timestamp) }}</span>
          <span v-if="entry.engramId" class="text-dim truncate">{{ entry.engramId }}</span>
          <span class="text-fg truncate flex-1 min-w-0">{{ entry.query }}</span>
        </div>

        <div class="px-2 py-2 space-y-2">
          <!-- Preamble (collapsible) -->
          <div v-if="entry.preamble">
            <button
              class="text-xs text-accent hover:text-fg cursor-pointer flex items-center gap-1"
              @click="debug.toggleText(`${entry.id}:preamble`)"
            >
              <span class="text-dim w-3 inline-block">
                {{ debug.isTextExpanded(`${entry.id}:preamble`) ? "▾" : "▸" }}
              </span>
              preamble ({{ entry.preamble.length }} chars)
            </button>
            <pre
              v-if="debug.isTextExpanded(`${entry.id}:preamble`)"
              class="mt-1 text-xs text-fg/80 whitespace-pre-wrap break-words border border-dim/60 rounded px-2 py-1"
              >{{ entry.preamble }}</pre
            >
          </div>
          <div v-else class="text-xs text-dim italic">preamble: (none)</div>

          <!-- System prompt (collapsible) -->
          <div v-if="entry.systemPrompt">
            <button
              class="text-xs text-accent hover:text-fg cursor-pointer flex items-center gap-1"
              @click="debug.toggleText(`${entry.id}:systemPrompt`)"
            >
              <span class="text-dim w-3 inline-block">
                {{ debug.isTextExpanded(`${entry.id}:systemPrompt`) ? "▾" : "▸" }}
              </span>
              systemPrompt ({{ entry.systemPrompt.length }} chars)
            </button>
            <pre
              v-if="debug.isTextExpanded(`${entry.id}:systemPrompt`)"
              class="mt-1 text-xs text-fg/80 whitespace-pre-wrap break-words border border-dim/60 rounded px-2 py-1"
              >{{ entry.systemPrompt }}</pre
            >
          </div>
          <div v-else class="text-xs text-dim italic">systemPrompt: (none)</div>

          <!-- Timing -->
          <div v-if="entry.timing && Object.keys(entry.timing).length > 0">
            <div class="text-xs text-dim mb-1">timing (ms):</div>
            <div class="space-y-0.5">
              <div
                v-for="(ms, key) in entry.timing"
                :key="key"
                class="flex items-center gap-2 text-xs"
              >
                <span class="text-dim w-20 shrink-0 truncate">{{ key }}</span>
                <span
                  class="bg-accent/40 h-2 rounded shrink-0"
                  :style="{ width: barWidthPx(ms, maxTimingMs(entry.timing)) + 'px' }"
                />
                <span class="text-fg">{{ ms }}</span>
              </div>
            </div>
          </div>
          <div v-else class="text-xs text-dim italic">timing: (none)</div>
        </div>
      </div>
    </div>
  </div>
</template>
