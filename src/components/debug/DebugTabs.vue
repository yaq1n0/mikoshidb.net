<script setup lang="ts">
import { useDebugStore, type DebugTab } from "@/stores/debug";
import RagTab from "@/components/debug/RagTab.vue";
import PromptsTab from "@/components/debug/PromptsTab.vue";
import CacheTab from "@/components/debug/CacheTab.vue";
import SessionTab from "@/components/debug/SessionTab.vue";

const debug = useDebugStore();

const TABS: { id: DebugTab; label: string }[] = [
  { id: "rag", label: "RAG" },
  { id: "prompts", label: "PROMPTS" },
  { id: "cache", label: "CACHE" },
  { id: "session", label: "SESSION" },
];
</script>

<template>
  <aside class="h-full w-full flex flex-col border-l border-dim font-mono text-sm bg-bg-alt/90">
    <!-- Header -->
    <div class="flex items-center px-3 py-2 border-b border-dim shrink-0">
      <span class="text-accent glow text-xs font-bold tracking-widest">DEBUG</span>
    </div>

    <!-- Tab strip -->
    <div class="flex border-b border-dim shrink-0 text-xs">
      <button
        v-for="tab in TABS"
        :key="tab.id"
        class="px-3 py-1.5 cursor-pointer border-r border-dim hover:bg-fg/5"
        :class="
          debug.activeTab === tab.id
            ? 'text-accent border-b-2 border-b-accent -mb-px bg-fg/5'
            : 'text-dim hover:text-fg'
        "
        @click="debug.setActiveTab(tab.id)"
      >
        {{ tab.label }}
      </button>
    </div>

    <!-- Active body -->
    <div class="flex-1 min-h-0">
      <RagTab v-if="debug.activeTab === 'rag'" />
      <PromptsTab v-else-if="debug.activeTab === 'prompts'" />
      <CacheTab v-else-if="debug.activeTab === 'cache'" />
      <SessionTab v-else-if="debug.activeTab === 'session'" />
    </div>
  </aside>
</template>
