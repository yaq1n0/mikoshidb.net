<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from "vue";
import BootSequence from "@/components/BootSequence.vue";
import Terminal from "@/components/Terminal.vue";
import LockoutScreen, { type LockoutReason } from "@/components/LockoutScreen.vue";
import InitializingScreen from "@/components/InitializingScreen.vue";
import DebugTabs from "@/components/debug/DebugTabs.vue";
import { detectWebGPU } from "@/llm/webgpu";
import { applyTheme } from "@/themes";
import { clearScrollback, print, printLines, setResumeHandler } from "@/terminal/session";
import { useSessionStore } from "@/stores/session";
import { useBootStore } from "@/stores/boot";
import { useChatStore } from "@/stores/chat";
import { useDebugStore, MIN_W, MAX_W } from "@/stores/debug";
import { acquireSessionLock } from "@/services/sessionLock";
import { findEngram } from "@/engrams";
import { findFirmware } from "@/firmware";
import { runCommand } from "@/terminal/commands";

const sessionStore = useSessionStore();
const bootStore = useBootStore();

// Apply the persisted theme on load and whenever it changes.
applyTheme(sessionStore.theme);
watch(
  () => sessionStore.theme,
  (id) => applyTheme(id),
);

const debugMode = computed(() => new URLSearchParams(window.location.search).has("debug"));

type Phase = "checking" | "lockout" | "booting" | "resume-prompt" | "ready";

const phase = ref<Phase>("checking");
const lockReason = ref<LockoutReason | null>(null);

// Debug pane width is owned by the debug store; the pinia plugin handles
// localStorage persistence under `mikoshi.debug`. The legacy
// `mikoshi.debug.width` key is dropped silently per PLAN §2.
const debugStore = useDebugStore();
const dragging = ref(false);

/** Handles drag move. */
const onDragMove = (e: MouseEvent): void => {
  const w = window.innerWidth - e.clientX;
  // Clamping happens inside the store; passing the raw value keeps both ends
  // of the bound consistent if the constants ever shift.
  debugStore.setWidth(Math.max(MIN_W, Math.min(MAX_W, w)));
};

/** Handles drag end. */
const onDragEnd = (): void => {
  dragging.value = false;
  document.body.style.userSelect = "";
  document.body.style.cursor = "";
  window.removeEventListener("mousemove", onDragMove);
  window.removeEventListener("mouseup", onDragEnd);
};

/** Starts drag. */
const startDrag = (e: MouseEvent): void => {
  e.preventDefault();
  dragging.value = true;
  document.body.style.userSelect = "none";
  document.body.style.cursor = "col-resize";
  window.addEventListener("mousemove", onDragMove);
  window.addEventListener("mouseup", onDragEnd);
};

/**
 * Build the resume-prompt handler. Consumed exactly once — the handler calls
 * setResumeHandler(null) before returning, so the next input falls through to
 * the normal command path.
 *
 * Answer semantics:
 *   - "", "y", "Y", "yes"  → resume (load firmware, jack-in, restore history)
 *   - "n", "N", "no"        → decline, clear persisted session, stay in shell
 *   - anything else         → treat as decline (unrecognized ⇒ safe default)
 */
const makeResumeAnswerHandler = () => {
  return async (raw: string): Promise<void> => {
    const answer = raw.trim().toLowerCase();
    const isYes = answer === "" || answer === "y" || answer === "yes";
    const isNo = answer === "n" || answer === "no";

    // Clear the hook immediately — any further input after this goes through
    // the normal dispatcher. Doing this up front also short-circuits retries
    // if resume itself fails partway through.
    setResumeHandler(null);

    const chat = useChatStore();

    if (!isYes && !isNo) {
      print(`>> unrecognized answer: ${raw}. treating as 'n'.`, "warn");
      await chat.clear();
      phase.value = "ready";
      return;
    }

    if (isNo) {
      print(">> neural link discarded.", "info");
      await chat.clear();
      phase.value = "ready";
      return;
    }

    // Yes path: validate the persisted firmware/engram still exist in the
    // catalog. If the catalog shifted out from under us, treat as decline.
    const fwId = chat.firmwareId;
    const egId = chat.engramId;
    if (!fwId || !egId) {
      print(">> persisted link metadata missing. discarding.", "warn");
      await chat.clear();
      phase.value = "ready";
      return;
    }
    const fw = findFirmware(fwId);
    const eg = findEngram(egId);
    if (!fw || !eg) {
      print(`>> firmware or engram no longer available (${fwId} / ${egId}). discarding.`, "warn");
      await chat.clear();
      phase.value = "ready";
      return;
    }

    // Snapshot the persisted history — `load firmware` reaches into
    // `jack-in` semantics only via the user; we call both programmatically.
    // `jack-in` resets chatHistory, so we must save & restore around it.
    const savedHistory = chat.chatHistory.slice();
    const savedStartedAt = chat.startedAt;
    const savedLastTurnAt = chat.lastTurnAt;

    // Hand the shell mode a clean slate before firing the commands. `load
    // firmware` is async and drives its own progress bars.
    await runCommand("load", ["firmware", fw.id]);
    // If the engine is online after load, `jack-in` will succeed.
    await runCommand("jack-in", [eg.id]);

    // Restore the persisted history — `jack-in` wiped it; we want full
    // continuity.
    chat.chatHistory = savedHistory;
    chat.startedAt = savedStartedAt || Date.now();
    chat.lastTurnAt = savedLastTurnAt || Date.now();

    // Resume banner — goes through the scrollback persistence path just like
    // any other output.
    const ts = new Date().toISOString();
    printLines(["", `──── resumed neural link ─ ${ts} ────`, ""], "banner");

    phase.value = "ready";
  };
};

/** Boot. */
const boot = async (): Promise<void> => {
  // Gate 1: single-tab lock.
  const lockAcquired = await acquireSessionLock();
  if (!lockAcquired) {
    lockReason.value = "session-locked";
    phase.value = "lockout";
    return;
  }

  // Gate 2: WebGPU.
  const hasWebGPU = await detectWebGPU();
  if (!hasWebGPU) {
    lockReason.value = "no-webgpu";
    phase.value = "lockout";
    return;
  }

  // Gate 3: prior chat session?
  const chat = useChatStore();
  if (chat.hasPriorSession) {
    // Print the resume prompt into the terminal scrollback, install the
    // answer handler, and flip into resume-prompt phase. The Terminal
    // component mounts for this phase because its case is folded into the
    // `ready` branch below.
    const info = chat.summary;
    if (info) {
      printLines(
        [
          "",
          `>> prior neural link detected: ${info.handle} (${info.turns} turn${info.turns === 1 ? "" : "s"}, ${info.timeAgo})`,
          ">> reload firmware and resume chat? [Y/n]",
          "",
        ],
        "info",
      );
    }
    setResumeHandler(makeResumeAnswerHandler());
    phase.value = "resume-prompt";
    return;
  }

  phase.value = "booting";
};

/** Handles boot done. */
const onBootDone = (): void => {
  phase.value = "ready";
};

/** Handles reboot. */
const onReboot = (): void => {
  // Fire-and-forget; the booting phase kicks off immediately while the IDB
  // wipes proceed in the background. Per PLAN §7: reboot clears chat in
  // addition to scrollback.
  void clearScrollback();
  void useChatStore().clear();
  // Also drop any in-flight resume hook — we're starting over.
  setResumeHandler(null);
  phase.value = "booting";
};

onMounted(async () => {
  // Hydration gate sits OUTSIDE the WebGPU phase — we always need persisted
  // state (scrollback/chat/rag) before any downstream component mounts,
  // including LockoutScreen.
  await bootStore.hydrate();
  await boot();
});
onBeforeUnmount(() => {
  window.removeEventListener("mousemove", onDragMove);
  window.removeEventListener("mouseup", onDragEnd);
});
</script>

<template>
  <div class="crt h-full w-full flex">
    <div class="flex-1 min-w-0 h-full">
      <InitializingScreen v-if="!bootStore.ready" />
      <template v-else>
        <LockoutScreen v-if="phase === 'lockout' && lockReason" :reason="lockReason" />
        <BootSequence v-else-if="phase === 'checking' || phase === 'booting'" @done="onBootDone" />
        <Terminal v-else-if="phase === 'ready' || phase === 'resume-prompt'" @reboot="onReboot" />
      </template>
    </div>
    <template v-if="debugMode">
      <div
        class="shrink-0 w-1 cursor-col-resize bg-dim/30 hover:bg-accent/60 transition-colors"
        :class="{ 'bg-accent/70': dragging }"
        @mousedown="startDrag"
      />
      <div class="shrink-0 h-full" :style="{ width: debugStore.debugWidth + 'px' }">
        <DebugTabs />
      </div>
    </template>
  </div>
</template>
