<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import BootSequence from "@/components/BootSequence.vue";
import Terminal from "@/components/Terminal.vue";
import LockoutScreen from "@/components/LockoutScreen.vue";
import DebugSidebar from "@/components/DebugSidebar.vue";
import { detectWebGPU } from "@/llm/webgpu";
import { loadSavedTheme } from "@/themes";
import { session, clearScrollback } from "@/terminal/session";

const debugMode = computed(() => new URLSearchParams(window.location.search).has("debug"));

type Phase = "checking" | "lockout" | "booting" | "ready";

const phase = ref<Phase>("checking");

async function boot(): Promise<void> {
  session.theme = loadSavedTheme();
  const hasWebGPU = await detectWebGPU();
  if (!hasWebGPU) {
    phase.value = "lockout";
    return;
  }
  phase.value = "booting";
}

function onBootDone(): void {
  phase.value = "ready";
}

function onReboot(): void {
  clearScrollback();
  phase.value = "booting";
}

onMounted(boot);
</script>

<template>
  <div class="crt h-full w-full">
    <BootSequence v-if="phase === 'checking' || phase === 'booting'" @done="onBootDone" />
    <Terminal v-else-if="phase === 'ready'" @reboot="onReboot" />
    <LockoutScreen v-else-if="phase === 'lockout'" />
    <DebugSidebar v-if="debugMode" />
  </div>
</template>
