<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from "vue";
import { session, print, focusInput } from "@/terminal/session";
import { parse } from "@/terminal/parser";
import { runCommand, runSlashCommand, sendChat } from "@/terminal/commands";

const emit = defineEmits<{ (e: "reboot"): void }>();

const inputRef = ref<HTMLInputElement | null>(null);
const scrollRef = ref<HTMLDivElement | null>(null);
const draft = ref("");
const busy = ref(false);
const history = ref<string[]>([]);
const historyIndex = ref<number | null>(null);

function scrollToBottom(): void {
  nextTick(() => {
    if (scrollRef.value) {
      scrollRef.value.scrollTop = scrollRef.value.scrollHeight;
    }
  });
}

watch(
  () => session.scrollback.length,
  () => scrollToBottom(),
);
// Also re-scroll when the last line's text mutates (streaming chat reply,
// live progress bar) — length alone doesn't change in those cases.
watch(
  () => {
    const last = session.scrollback[session.scrollback.length - 1];
    return last ? last.text.length + (last.progress ?? 0) : 0;
  },
  () => scrollToBottom(),
);

watch(focusInput, () => inputRef.value?.focus());

onMounted(() => {
  inputRef.value?.focus();
  scrollToBottom();
});

function promptPrefix(): string {
  if (session.mode === "chat" && session.currentEngram) {
    return `${session.currentEngram.handle}> `;
  }
  if (session.mode === "loading") return "flashing... ";
  return "mikoshi> ";
}

async function onSubmit(): Promise<void> {
  if (busy.value) return;
  const raw = draft.value;
  draft.value = "";
  historyIndex.value = null;

  if (raw.trim()) history.value.push(raw);

  // Echo the line into scrollback
  print(`${promptPrefix()}${raw}`, "cmd");

  if (session.mode === "chat") {
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
}

function onKeyDown(e: KeyboardEvent): void {
  if (e.key === "ArrowUp") {
    e.preventDefault();
    if (history.value.length === 0) return;
    if (historyIndex.value === null) {
      historyIndex.value = history.value.length - 1;
    } else if (historyIndex.value > 0) {
      historyIndex.value -= 1;
    }
    draft.value = history.value[historyIndex.value] ?? "";
  } else if (e.key === "ArrowDown") {
    e.preventDefault();
    if (historyIndex.value === null) return;
    if (historyIndex.value < history.value.length - 1) {
      historyIndex.value += 1;
      draft.value = history.value[historyIndex.value] ?? "";
    } else {
      historyIndex.value = null;
      draft.value = "";
    }
  } else if (e.ctrlKey && e.key.toLowerCase() === "l") {
    e.preventDefault();
    session.scrollback.length = 0;
  }
}

function lineClass(kind: string): string {
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
}
</script>

<template>
  <div class="h-full flex flex-col" @click="inputRef?.focus()">
    <div ref="scrollRef" class="flex-1 overflow-y-auto px-6 py-4 space-y-0">
      <div
        v-for="line in session.scrollback"
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
        :disabled="busy && session.mode !== 'chat'"
        class="flex-1 bg-transparent outline-none border-none text-fg glow caret-accent"
        @keydown="onKeyDown"
      />
    </form>
  </div>
</template>
