<script setup lang="ts">
import { computed } from "vue";
import { useSessionStore } from "@/stores/session";
import { useChatStore } from "@/stores/chat";
import { useTerminalStore } from "@/stores/terminal";

const session = useSessionStore();
const chat = useChatStore();
const terminal = useTerminalStore();

const turnCount = computed<number>(() => chat.chatHistory.length);
const scrollbackCount = computed<number>(() => terminal.scrollback.length);
const commandCount = computed<number>(() => terminal.commandHistory.length);

function fmt(ts: number | null | undefined): string {
  if (!ts || ts === 0) return "(never)";
  return new Date(ts).toISOString();
}

function fmtMaybe(v: string | null | undefined): string {
  return v ?? "(none)";
}

async function onClearChat(): Promise<void> {
  if (!confirm("Clear chat session? This wipes the persisted neural link.")) return;
  await chat.clear();
}

async function onClearScrollback(): Promise<void> {
  if (!confirm("Clear scrollback? This wipes all persisted terminal lines.")) return;
  await terminal.clearScrollback();
}
</script>

<template>
  <div class="h-full flex flex-col">
    <div class="px-3 py-2 border-b border-dim text-xs text-dim shrink-0">session inspector</div>
    <div class="flex-1 overflow-y-auto px-3 py-2 space-y-3 text-xs">
      <!-- Session -->
      <section class="border border-dim rounded">
        <div class="px-2 py-1 border-b border-dim text-accent font-bold">session</div>
        <div class="px-2 py-1.5 space-y-0.5">
          <div><span class="text-dim">mode: </span><span class="text-fg">{{ session.mode }}</span></div>
          <div><span class="text-dim">theme: </span><span class="text-fg">{{ session.theme }}</span></div>
          <div>
            <span class="text-dim">currentEngramId: </span>
            <span class="text-fg break-all">{{ fmtMaybe(session.currentEngramId) }}</span>
          </div>
          <div>
            <span class="text-dim">currentFirmwareId: </span>
            <span class="text-fg break-all">{{ fmtMaybe(session.currentFirmwareId) }}</span>
          </div>
        </div>
      </section>

      <!-- Chat -->
      <section class="border border-dim rounded">
        <div class="px-2 py-1 border-b border-dim text-accent font-bold">chat</div>
        <div class="px-2 py-1.5 space-y-0.5">
          <div>
            <span class="text-dim">firmwareId: </span>
            <span class="text-fg break-all">{{ fmtMaybe(chat.firmwareId) }}</span>
          </div>
          <div>
            <span class="text-dim">engramId: </span>
            <span class="text-fg break-all">{{ fmtMaybe(chat.engramId) }}</span>
          </div>
          <div>
            <span class="text-dim">startedAt: </span>
            <span class="text-fg">{{ fmt(chat.startedAt) }}</span>
          </div>
          <div>
            <span class="text-dim">lastTurnAt: </span>
            <span class="text-fg">{{ fmt(chat.lastTurnAt) }}</span>
          </div>
          <div>
            <span class="text-dim">turns: </span><span class="text-fg">{{ turnCount }}</span>
          </div>
        </div>
      </section>

      <!-- Scrollback -->
      <section class="border border-dim rounded">
        <div class="px-2 py-1 border-b border-dim text-accent font-bold">scrollback</div>
        <div class="px-2 py-1.5 space-y-0.5">
          <div>
            <span class="text-dim">in-memory lines: </span>
            <span class="text-fg">{{ scrollbackCount }}</span>
          </div>
          <div>
            <span class="text-dim">oldestLoadedId: </span>
            <span class="text-fg">{{ terminal.oldestLoadedId ?? "(null)" }}</span>
          </div>
          <div>
            <span class="text-dim">canLoadEarlier: </span>
            <span class="text-fg">{{ terminal.canLoadEarlier }}</span>
          </div>
        </div>
      </section>

      <!-- Commands -->
      <section class="border border-dim rounded">
        <div class="px-2 py-1 border-b border-dim text-accent font-bold">commands</div>
        <div class="px-2 py-1.5 space-y-0.5">
          <div>
            <span class="text-dim">history length: </span>
            <span class="text-fg">{{ commandCount }}</span>
          </div>
        </div>
      </section>

      <!-- Actions -->
      <section class="border border-dim rounded">
        <div class="px-2 py-1 border-b border-dim text-accent font-bold">actions</div>
        <div class="px-2 py-2 flex flex-col gap-1.5">
          <button
            class="text-xs px-2 py-1 border border-dim rounded text-dim hover:text-danger hover:border-danger cursor-pointer text-left"
            @click="onClearChat"
          >
            clear chat session
          </button>
          <button
            class="text-xs px-2 py-1 border border-dim rounded text-dim hover:text-danger hover:border-danger cursor-pointer text-left"
            @click="onClearScrollback"
          >
            clear scrollback
          </button>
        </div>
      </section>
    </div>
  </div>
</template>
