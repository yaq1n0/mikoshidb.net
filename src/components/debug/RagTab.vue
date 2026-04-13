<script setup lang="ts">
import { ref } from "vue";
import { ragLog, clearRagLog, exportRagLogJson } from "@/terminal/ragLog";
import { useDebugStore } from "@/stores/debug";

const PREVIEW_CHARS = 200;

const debug = useDebugStore();
const copied = ref(false);

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

function fmtDirective(out: unknown): string {
  if (!out) return "null";
  return JSON.stringify(out, null, 2);
}
</script>

<template>
  <div class="h-full flex flex-col">
    <!-- Toolbar -->
    <div class="flex items-center justify-between px-3 py-2 border-b border-dim shrink-0 gap-2">
      <span class="text-xs text-dim">
        {{ ragLog.length }} logged quer{{ ragLog.length === 1 ? "y" : "ies" }}
      </span>
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

    <!-- Scrollable body -->
    <div class="flex-1 overflow-y-auto px-3 py-2 space-y-2">
      <div v-if="ragLog.length === 0" class="text-dim text-xs italic py-4">No retrieval data</div>

      <div v-for="entry in ragLog" :key="entry.id" class="border border-dim rounded">
        <!-- Entry header (clickable) -->
        <button
          class="w-full text-left px-2 py-1.5 flex items-start gap-2 hover:bg-fg/5 cursor-pointer"
          @click="debug.toggleEntry(entry.id)"
        >
          <span class="text-dim text-xs shrink-0 w-4">
            {{ debug.isEntryExpanded(entry.id) ? "▾" : "▸" }}
          </span>
          <div class="flex-1 min-w-0">
            <div class="flex items-baseline gap-2 text-xs">
              <span class="text-dim shrink-0">{{ fmtTime(entry.timestamp) }}</span>
              <span class="text-accent shrink-0">{{ entry.selected.length }} chunks</span>
              <span
                v-if="entry.resolverFallback !== 'none'"
                class="shrink-0 text-danger"
                :title="`resolver fallback: ${entry.resolverFallback}`"
              >
                {{ entry.resolverFallback }}
              </span>
              <span v-if="entry.engramId" class="text-dim shrink-0 truncate">
                {{ entry.engramId }}
              </span>
            </div>
            <div class="text-fg text-xs mt-0.5 break-words">{{ entry.query }}</div>
          </div>
        </button>

        <!-- Expanded details -->
        <div v-if="debug.isEntryExpanded(entry.id)" class="border-t border-dim px-2 py-2 space-y-3">
          <!-- Meta -->
          <div class="text-xs space-y-0.5">
            <div v-if="entry.cutoffEventId">
              <span class="text-dim">cutoffEventId: </span>
              <span class="text-fg break-all">{{ entry.cutoffEventId }}</span>
            </div>
            <div v-if="Object.keys(entry.timing).length > 0">
              <span class="text-dim">timing: </span>
              <span class="text-fg">
                <template v-for="(ms, phase, idx) in entry.timing" :key="phase">
                  <span v-if="idx !== 0" class="text-dim">, </span>
                  {{ phase }}={{ ms }}ms
                </template>
              </span>
            </div>
          </div>

          <!-- Resolver panel -->
          <details class="border border-dim/60 rounded">
            <summary class="cursor-pointer px-2 py-1 text-xs text-accent">
              Resolver ({{ entry.resolverFallback }})
            </summary>
            <div class="px-2 py-1.5 space-y-2 text-xs">
              <div v-if="entry.resolverMessages.length > 0">
                <div class="text-dim mb-0.5">messages:</div>
                <div
                  v-for="(m, i) in entry.resolverMessages"
                  :key="`msg:${entry.id}:${i}`"
                  class="border border-dim/40 rounded px-1.5 py-1 mb-1"
                >
                  <div class="text-accent">[{{ m.role }}]</div>
                  <pre class="whitespace-pre-wrap break-words text-fg/80">{{ m.content }}</pre>
                </div>
              </div>
              <div v-if="entry.resolverRaw">
                <div class="text-dim mb-0.5">raw LLM output:</div>
                <pre
                  class="whitespace-pre-wrap break-words text-fg/80 border border-dim/40 rounded px-1.5 py-1"
                  >{{ entry.resolverRaw }}</pre
                >
              </div>
              <div v-if="entry.resolverOutput">
                <div class="text-dim mb-0.5">parsed directive:</div>
                <pre
                  class="whitespace-pre-wrap break-words text-fg/80 border border-dim/40 rounded px-1.5 py-1"
                  >{{ fmtDirective(entry.resolverOutput) }}</pre
                >
              </div>
            </div>
          </details>

          <!-- Traversal panel -->
          <details class="border border-dim/60 rounded">
            <summary class="cursor-pointer px-2 py-1 text-xs text-accent">
              Traversal ({{ entry.resolvedEntities.length }} anchor{{
                entry.resolvedEntities.length === 1 ? "" : "s"
              }}, {{ entry.traversalNodes.length }} node{{
                entry.traversalNodes.length === 1 ? "" : "s"
              }})
            </summary>
            <div class="px-2 py-1.5 space-y-2 text-xs">
              <div v-if="entry.resolvedEntities.length > 0">
                <div class="text-dim mb-0.5">resolved entities:</div>
                <ul class="list-disc pl-4">
                  <li
                    v-for="r in entry.resolvedEntities"
                    :key="`res:${entry.id}:${r.alias}`"
                    class="text-fg"
                  >
                    <span class="text-accent">{{ r.alias }}</span>
                    <span class="text-dim"> → </span>
                    <span>{{ r.articleId }}</span>
                  </li>
                </ul>
              </div>
              <div v-if="entry.traversalNodes.length > 0">
                <div class="text-dim mb-0.5">nodes (hop / kind / id):</div>
                <ul class="font-mono">
                  <li
                    v-for="n in entry.traversalNodes"
                    :key="`node:${entry.id}:${n.id}:${n.hops}`"
                    class="text-xs"
                    :class="n.included ? 'text-fg' : 'text-dim'"
                  >
                    <span>{{ n.included ? "+" : "-" }}</span>
                    <span class="ml-1">h{{ n.hops }}</span>
                    <span class="ml-1 text-accent">[{{ n.kind }}]</span>
                    <span class="ml-1 break-all">{{ n.id }}</span>
                    <span v-if="n.droppedReason" class="text-danger ml-1"
                      >({{ n.droppedReason }})</span
                    >
                  </li>
                </ul>
              </div>
            </div>
          </details>

          <!-- Selected chunks panel -->
          <details class="border border-dim/60 rounded" open>
            <summary class="cursor-pointer px-2 py-1 text-xs text-accent">
              Selected chunks ({{ entry.selected.length }})
            </summary>
            <div class="px-2 py-1.5 space-y-2">
              <div v-if="entry.selected.length === 0" class="text-dim text-xs italic">
                no chunks retrieved
              </div>
              <div
                v-for="(rc, i) in entry.selected"
                :key="`${entry.id}:${i}`"
                class="border border-dim/60 rounded px-2 py-1.5 space-y-0.5"
              >
                <div class="flex items-center justify-between text-xs">
                  <span class="text-accent font-bold">#{{ i + 1 }}</span>
                  <span class="text-accent"> {{ rc.source }} h{{ rc.hops }} </span>
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
                      debug.isTextExpanded(`${entry.id}:${i}`) ||
                      rc.chunk.text.length <= PREVIEW_CHARS
                        ? rc.chunk.text
                        : rc.chunk.text.slice(0, PREVIEW_CHARS) + "…"
                    }}
                  </div>
                  <button
                    v-if="rc.chunk.text.length > PREVIEW_CHARS"
                    class="text-accent hover:text-fg text-xs mt-0.5 cursor-pointer"
                    @click="debug.toggleText(`${entry.id}:${i}`)"
                  >
                    {{ debug.isTextExpanded(`${entry.id}:${i}`) ? "[less]" : "[more]" }}
                  </button>
                </div>
              </div>
            </div>
          </details>

          <!-- Preamble + system prompt -->
          <details v-if="entry.preamble" class="border border-dim/60 rounded">
            <summary class="cursor-pointer px-2 py-1 text-xs text-accent">Lore preamble</summary>
            <pre class="px-2 py-1.5 whitespace-pre-wrap break-words text-fg/80 text-xs">{{
              entry.preamble
            }}</pre>
          </details>
          <details v-if="entry.systemPrompt" class="border border-dim/60 rounded">
            <summary class="cursor-pointer px-2 py-1 text-xs text-accent">System prompt</summary>
            <pre class="px-2 py-1.5 whitespace-pre-wrap break-words text-fg/80 text-xs">{{
              entry.systemPrompt
            }}</pre>
          </details>
        </div>
      </div>
    </div>
  </div>
</template>
