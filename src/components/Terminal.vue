<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { print, focusInput, getResumeHandler } from "@/terminal/session";
import { parse } from "@/terminal/parser";
import { runCommand, runSlashCommand, sendChat } from "@/terminal/commands";
import { useSessionStore } from "@/stores/session";
import { useTerminalStore } from "@/stores/terminal";
import { findEngram } from "@/engrams";

const sessionStore = useSessionStore();
const terminalStore = useTerminalStore();
const currentEngram = computed(() =>
  sessionStore.currentEngramId ? findEngram(sessionStore.currentEngramId) : null,
);

const emit = defineEmits<{ (e: "reboot"): void }>();

const inputRef = ref<HTMLInputElement | null>(null);
const scrollRef = ref<HTMLDivElement | null>(null);
const draft = ref("");
const busy = ref(false);

const scrollToBottom = (): void => {
  nextTick(() => {
    if (scrollRef.value) {
      scrollRef.value.scrollTop = scrollRef.value.scrollHeight;
    }
  });
};

const visibleLines = computed(() => terminalStore.visibleLines);

watch(
  () => visibleLines.value.length,
  (newLen, oldLen) => {
    // Only auto-scroll on append. Prepend (load-earlier) is handled by the
    // scroll-anchor logic in maybeLoadEarlier so the view doesn't jump.
    if (newLen > oldLen) scrollToBottom();
  },
);
// Also re-scroll when the last line's text mutates (streaming chat reply,
// live progress bar) — length alone doesn't change in those cases.
watch(
  () => {
    const lines = visibleLines.value;
    const last = lines[lines.length - 1];
    return last ? last.text.length + (last.progress ?? 0) : 0;
  },
  () => scrollToBottom(),
);

// Auto-fire loadEarlierPage when the user scrolls near the top. Preserve
// scroll position with the scrollHeight-delta trick so the viewport stays
// anchored on the line the user was looking at.
let loadingEarlier = false;
const maybeLoadEarlier = async (): Promise<void> => {
  const el = scrollRef.value;
  if (!el) return;
  if (loadingEarlier) return;
  if (!terminalStore.canLoadEarlier) return;
  if (el.scrollTop > 40) return;
  loadingEarlier = true;
  const prevHeight = el.scrollHeight;
  try {
    await terminalStore.loadEarlierPage();
    await nextTick();
    const newHeight = el.scrollHeight;
    el.scrollTop = el.scrollTop + (newHeight - prevHeight);
  } finally {
    loadingEarlier = false;
  }
};

const onScroll = (): void => {
  void maybeLoadEarlier();
};

watch(focusInput, () => inputRef.value?.focus());

onMounted(() => {
  inputRef.value?.focus();
  scrollToBottom();
});

const promptPrefix = (): string => {
  if (sessionStore.mode === "chat" && currentEngram.value) {
    return `${currentEngram.value.handle}> `;
  }
  if (sessionStore.mode === "loading") return "flashing... ";
  return "mikoshi> ";
};

const onSubmit = async (): Promise<void> => {
  if (busy.value) return;
  const raw = draft.value;
  draft.value = "";

  // recordCommand handles trim/empty/dedup/cap and resets nav cursor.
  // In chat mode we deliberately skip it — the store is shell-history only.
  if (sessionStore.mode !== "chat") {
    terminalStore.recordCommand(raw);
  } else {
    terminalStore.resetNav();
  }

  // Echo the line into scrollback
  print(`${promptPrefix()}${raw}`, "cmd");

  // Resume-prompt interception: if App.vue installed a handler while a prior
  // chat session was detected, the first submit is an answer to "[Y/n]" — not
  // a command. The handler clears itself once consumed (see App.vue).
  const resumeHandler = getResumeHandler();
  if (resumeHandler) {
    busy.value = true;
    try {
      await resumeHandler(raw);
    } finally {
      busy.value = false;
    }
    return;
  }

  if (sessionStore.mode === "chat") {
    if (!raw.trim()) return;
    // '/' is the in-link escape prefix: slash commands (/disconnect, /status,
    // /help, ...) run locally instead of being streamed to the engram.
    if (raw.trimStart().startsWith("/")) {
      busy.value = true;
      try {
        await runSlashCommand(raw.trim());
      } finally {
        busy.value = false;
      }
      return;
    }
    busy.value = true;
    try {
      await sendChat(raw);
    } finally {
      busy.value = false;
    }
    return;
  }

  const parsed = parse(raw);
  if (!parsed) return;

  if (parsed.command === "reboot") {
    emit("reboot");
    return;
  }

  busy.value = true;
  try {
    await runCommand(parsed.command, parsed.args);
  } finally {
    busy.value = false;
  }
};

const onKeyDown = (e: KeyboardEvent): void => {
  if (e.key === "ArrowUp") {
    // Inert in chat mode — let the input handle the keystroke natively.
    if (sessionStore.mode === "chat") return;
    e.preventDefault();
    draft.value = terminalStore.navigatePrev(draft.value);
  } else if (e.key === "ArrowDown") {
    if (sessionStore.mode === "chat") return;
    e.preventDefault();
    draft.value = terminalStore.navigateNext();
  } else if (e.ctrlKey && e.key.toLowerCase() === "l") {
    e.preventDefault();
    // Fire-and-forget: UI doesn't need to block on the IDB wipe.
    void terminalStore.clearScrollback();
  }
};

const lineClass = (kind: string): string => {
  switch (kind) {
    case "cmd":
      return "text-fg/80";
    case "info":
      return "text-accent glow";
    case "warn":
      return "text-warn";
    case "error":
      return "text-danger glow";
    case "banner":
      return "text-accent glow";
    case "progress":
      return "text-accent";
    case "chat-user":
      return "text-fg/70 pl-2 border-l-2 border-dim";
    case "chat-reply":
      return "text-fg glow pl-2 border-l-2 border-accent";
    default:
      return "text-fg";
  }
};
</script>

<template>
  <div class="h-full flex flex-col" @click="inputRef?.focus()">
    <div ref="scrollRef" class="flex-1 overflow-y-auto px-6 py-4 space-y-0" @scroll="onScroll">
      <div
        v-for="line in visibleLines"
        :key="line.id"
        :class="['whitespace-pre-wrap break-words font-mono', lineClass(line.kind)]"
      >
        <template v-if="line.kind === 'chat-user'">
          <span class="text-dim">&gt;&gt; </span>{{ line.text }}
        </template>
        <template v-else-if="line.kind === 'chat-reply'">
          {{ line.text }}<span v-if="line.streaming" class="cursor" />
        </template>
        <template v-else>{{ line.text }}</template>
      </div>
    </div>

    <form class="px-6 py-3 border-t border-dim flex items-center gap-2" @submit.prevent="onSubmit">
      <span class="text-accent glow shrink-0">{{ promptPrefix() }}</span>
      <input
        ref="inputRef"
        v-model="draft"
        type="text"
        autocomplete="off"
        autocorrect="off"
        autocapitalize="off"
        spellcheck="false"
        :disabled="busy && sessionStore.mode !== 'chat'"
        class="flex-1 bg-transparent outline-none border-none text-fg glow caret-accent"
        @keydown="onKeyDown"
      />
    </form>
  </div>
</template>
