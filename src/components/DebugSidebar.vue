<script setup lang="ts">
import { ref, computed } from "vue";
import { session } from "@/terminal/session";
import type { RetrievedChunk } from "opensona/runtime";

const expanded = ref(true);

const chunks = computed<RetrievedChunk[]>(() => session.lastRetrieval);

const cutoffEventId = computed<string | null>(() => {
  return session.currentEngram?.cutoffEventId ?? null;
});

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + "...";
}
</script>

<template>
  <aside
    class="fixed top-0 right-0 h-full z-40 border-l border-dim font-mono text-sm transition-[width] duration-200 overflow-hidden"
    :style="{
      width: expanded ? '350px' : '40px',
      backgroundColor: 'color-mix(in srgb, var(--bg-alt) 90%, transparent)',
    }"
  >
    <!-- Collapsed: toggle button only -->
    <button
      v-if="!expanded"
      class="w-full h-full flex items-center justify-center text-accent hover:text-fg cursor-pointer"
      @click="expanded = true"
    >
      &lt;
    </button>

    <!-- Expanded content -->
    <div v-else class="flex flex-col h-full">
      <!-- Header -->
      <div class="flex items-center justify-between px-3 py-2 border-b border-dim shrink-0">
        <span class="text-accent glow text-xs font-bold tracking-widest">RAG DEBUG</span>
        <button class="text-dim hover:text-fg cursor-pointer text-xs" @click="expanded = false">
          &gt;
        </button>
      </div>

      <!-- Scrollable body -->
      <div class="flex-1 overflow-y-auto px-3 py-2 space-y-3">
        <!-- Cutoff info -->
        <div v-if="cutoffEventId" class="text-xs">
          <span class="text-dim">cutoffEventId: </span>
          <span class="text-fg break-all">{{ cutoffEventId }}</span>
        </div>

        <!-- Retrieved count -->
        <div class="text-xs text-dim">
          Retrieved: {{ chunks.length }} chunk{{ chunks.length !== 1 ? "s" : "" }}
        </div>

        <!-- No data -->
        <div v-if="chunks.length === 0" class="text-dim text-xs italic py-4">No retrieval data</div>

        <!-- Chunk cards -->
        <div
          v-for="(rc, i) in chunks"
          :key="rc.chunk.id"
          class="border border-dim rounded px-2 py-2 space-y-1"
        >
          <div class="text-accent text-xs font-bold">#{{ i + 1 }}</div>

          <div class="text-xs">
            <span class="text-dim">id: </span>
            <span class="text-fg break-all">{{ rc.chunk.id }}</span>
          </div>

          <div class="text-xs">
            <span class="text-dim">header: </span>
            <span class="text-fg">{{ rc.chunk.header }}</span>
          </div>

          <div class="text-xs">
            <span class="text-dim">score: </span>
            <span class="text-accent">{{ rc.score.toFixed(2) }}</span>
          </div>

          <div class="text-xs">
            <span class="text-dim">source: </span>
            <span class="text-fg">{{ rc.source }}</span>
          </div>

          <div class="text-xs">
            <span class="text-dim">eventIds: </span>
            <span class="text-fg break-all">{{
              rc.chunk.eventIds.length > 0 ? rc.chunk.eventIds.join(", ") : "none"
            }}</span>
          </div>

          <div class="text-xs">
            <span class="text-dim">latestEventOrder: </span>
            <span class="text-fg">{{ rc.chunk.latestEventOrder }}</span>
          </div>

          <div class="text-xs">
            <span class="text-dim">text: </span>
            <span class="text-fg/70 break-all">{{ truncate(rc.chunk.text, 200) }}</span>
          </div>
        </div>
      </div>
    </div>
  </aside>
</template>
