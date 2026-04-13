<script setup lang="ts">
import { ref } from "vue";
import { ragLog, clearRagLog, exportRagLogJson } from "@/terminal/ragLog";

const PREVIEW_CHARS = 200;

const expandedEntries = ref<Set<number>>(new Set());
const expandedTexts = ref<Set<string>>(new Set());
const copied = ref(false);

function toggleEntry(id: number): void {
  const s = new Set(expandedEntries.value);
  if (s.has(id)) s.delete(id);
  else s.add(id);
  expandedEntries.value = s;
}

function toggleText(key: string): void {
  const s = new Set(expandedTexts.value);
  if (s.has(key)) s.delete(key);
  else s.add(key);
  expandedTexts.value = s;
}

async function onCopy(): Promise<void> {
  try {
    await navigator.clipboard.writeText(exportRagLogJson());
    copied.value = true;
    setTimeout(() => (copied.value = false), 1200);
  } catch (err) {
    console.warn("[ragLog] clipboard failed:", err);
  }
}

function onDownload(): void {
  const blob = new Blob([exportRagLogJson()], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `rag-log-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function onClear(): void {
  if (confirm("Clear all logged RAG queries?")) clearRagLog();
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString(undefined, { hour12: false });
}
</script>

<template>
  <aside class="h-full w-full flex flex-col border-l border-dim font-mono text-sm bg-bg-alt/90">
    <!-- Header -->
    <div class="flex items-center justify-between px-3 py-2 border-b border-dim shrink-0 gap-2">
      <span class="text-accent glow text-xs font-bold tracking-widest">RAG DEBUG</span>
      <div class="flex items-center gap-1">
        <button
          class="text-xs px-2 py-0.5 border border-dim rounded text-dim hover:text-fg hover:border-fg cursor-pointer"
          :title="copied ? 'Copied!' : 'Copy JSON to clipboard'"
          @click="onCopy"
        >
          {{ copied ? "copied" : "copy" }}
        </button>
        <button
          class="text-xs px-2 py-0.5 border border-dim rounded text-dim hover:text-fg hover:border-fg cursor-pointer"
          title="Download JSON"
          @click="onDownload"
        >
          dump
        </button>
        <button
          class="text-xs px-2 py-0.5 border border-dim rounded text-dim hover:text-danger hover:border-danger cursor-pointer"
          title="Clear log"
          @click="onClear"
        >
          clear
        </button>
      </div>
    </div>

    <!-- Summary -->
    <div class="px-3 py-1 border-b border-dim text-xs text-dim shrink-0">
      {{ ragLog.length }} logged quer{{ ragLog.length === 1 ? "y" : "ies" }}
    </div>

    <!-- Scrollable body -->
    <div class="flex-1 overflow-y-auto px-3 py-2 space-y-2">
      <div v-if="ragLog.length === 0" class="text-dim text-xs italic py-4">No retrieval data</div>

      <div v-for="entry in ragLog" :key="entry.id" class="border border-dim rounded">
        <!-- Entry header (clickable) -->
        <button
          class="w-full text-left px-2 py-1.5 flex items-start gap-2 hover:bg-fg/5 cursor-pointer"
          @click="toggleEntry(entry.id)"
        >
          <span class="text-dim text-xs shrink-0 w-4">
            {{ expandedEntries.has(entry.id) ? "▾" : "▸" }}
          </span>
          <div class="flex-1 min-w-0">
            <div class="flex items-baseline gap-2 text-xs">
              <span class="text-dim shrink-0">{{ fmtTime(entry.timestamp) }}</span>
              <span class="text-accent shrink-0">{{ entry.chunks.length }}ch</span>
              <span v-if="entry.engramId" class="text-dim shrink-0 truncate">
                {{ entry.engramId }}
              </span>
            </div>
            <div class="text-fg text-xs mt-0.5 break-words">{{ entry.query }}</div>
          </div>
        </button>

        <!-- Expanded chunks -->
        <div v-if="expandedEntries.has(entry.id)" class="border-t border-dim px-2 py-2 space-y-2">
          <div v-if="entry.cutoffEventId" class="text-xs">
            <span class="text-dim">cutoffEventId: </span>
            <span class="text-fg break-all">{{ entry.cutoffEventId }}</span>
          </div>

          <div v-if="entry.chunks.length === 0" class="text-dim text-xs italic">
            no chunks retrieved
          </div>

          <div
            v-for="(rc, i) in entry.chunks"
            :key="`${entry.id}:${i}`"
            class="border border-dim/60 rounded px-2 py-1.5 space-y-0.5"
          >
            <div class="flex items-center justify-between text-xs">
              <span class="text-accent font-bold">#{{ i + 1 }}</span>
              <span class="text-accent">{{ rc.score.toFixed(3) }}</span>
            </div>
            <div class="text-xs">
              <span class="text-dim">id: </span>
              <span class="text-fg break-all">{{ rc.chunk.id }}</span>
            </div>
            <div class="text-xs">
              <span class="text-dim">header: </span>
              <span class="text-fg">{{ rc.chunk.header }}</span>
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
              <div class="text-dim">text:</div>
              <div class="text-fg/80 break-words whitespace-pre-wrap">
                {{
                  expandedTexts.has(`${entry.id}:${i}`) || rc.chunk.text.length <= PREVIEW_CHARS
                    ? rc.chunk.text
                    : rc.chunk.text.slice(0, PREVIEW_CHARS) + "…"
                }}
              </div>
              <button
                v-if="rc.chunk.text.length > PREVIEW_CHARS"
                class="text-accent hover:text-fg text-xs mt-0.5 cursor-pointer"
                @click="toggleText(`${entry.id}:${i}`)"
              >
                {{ expandedTexts.has(`${entry.id}:${i}`) ? "[less]" : "[more]" }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </aside>
</template>
