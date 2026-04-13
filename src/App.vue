<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from "vue";
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

const DEBUG_WIDTH_KEY = "mikoshi.debug.width";
const MIN_W = 240;
const MAX_W = 900;
const DEFAULT_W = 400;

function loadDebugWidth(): number {
  try {
    const raw = localStorage.getItem(DEBUG_WIDTH_KEY);
    const n = raw ? Number(raw) : NaN;
    if (Number.isFinite(n) && n >= MIN_W && n <= MAX_W) return n;
  } catch {
    /* ignore */
  }
  return DEFAULT_W;
}

const debugWidth = ref<number>(loadDebugWidth());
const dragging = ref(false);

function onDragMove(e: MouseEvent): void {
  const w = window.innerWidth - e.clientX;
  debugWidth.value = Math.max(MIN_W, Math.min(MAX_W, w));
}

function onDragEnd(): void {
  dragging.value = false;
  document.body.style.userSelect = "";
  document.body.style.cursor = "";
  window.removeEventListener("mousemove", onDragMove);
  window.removeEventListener("mouseup", onDragEnd);
  try {
    localStorage.setItem(DEBUG_WIDTH_KEY, String(debugWidth.value));
  } catch {
    /* ignore */
  }
}

function startDrag(e: MouseEvent): void {
  e.preventDefault();
  dragging.value = true;
  document.body.style.userSelect = "none";
  document.body.style.cursor = "col-resize";
  window.addEventListener("mousemove", onDragMove);
  window.addEventListener("mouseup", onDragEnd);
}

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
onBeforeUnmount(() => {
  window.removeEventListener("mousemove", onDragMove);
  window.removeEventListener("mouseup", onDragEnd);
});
</script>

<template>
  <div class="crt h-full w-full flex">
    <div class="flex-1 min-w-0 h-full">
      <BootSequence v-if="phase === 'checking' || phase === 'booting'" @done="onBootDone" />
      <Terminal v-else-if="phase === 'ready'" @reboot="onReboot" />
      <LockoutScreen v-else-if="phase === 'lockout'" />
    </div>
    <template v-if="debugMode">
      <div
        class="shrink-0 w-1 cursor-col-resize bg-dim/30 hover:bg-accent/60 transition-colors"
        :class="{ 'bg-accent/70': dragging }"
        @mousedown="startDrag"
      />
      <div class="shrink-0 h-full" :style="{ width: debugWidth + 'px' }">
        <DebugSidebar />
      </div>
    </template>
  </div>
</template>
