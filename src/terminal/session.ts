import { reactive, ref, shallowRef } from "vue";
import type { MLCEngineInterface } from "@mlc-ai/web-llm";
import type { OpensonaRuntime } from "opensona/runtime";
import {
  useTerminalStore,
  type LineKind as StoreLineKind,
  type ScrollbackLine as StoreScrollbackLine,
  _nextLineId,
} from "@/stores/terminal";

// Re-exported so existing importers (commands.ts, Terminal.vue templates, etc)
// keep working. Canonical definitions now live in the terminal store.
export type LineKind = StoreLineKind;
export type ScrollbackLine = StoreScrollbackLine;

export type Mode = "shell" | "chat" | "loading";

/**
 * Per-turn chat message shape. Migrated off the `session` reactive in Step 8
 * into `useChatStore` (see src/stores/chat.ts), but the type still lives here
 * so existing importers across commands.ts / llm/chat.ts keep a single source.
 */
export interface ChatHistoryEntry {
  role: "user" | "assistant";
  content: string;
}

// Engine lives outside reactive state so Vue does not try to proxy it.
export const engineRef = shallowRef<MLCEngineInterface | null>(null);

// RAG runtime — non-reactive (same reason as engineRef).
export const ragRef = shallowRef<OpensonaRuntime | null>(null);

// Input focus trigger for Terminal.vue
export const focusInput = ref(0);

/**
 * Resume-prompt hook — set by App.vue when a valid persisted chat session was
 * discovered during boot. While non-null, Terminal.vue routes the next submit
 * to this handler instead of the normal command dispatcher so the user's Y/n
 * answer is captured in the existing prompt line. Cleared (via `clearResumeHandler`)
 * after the first answer.
 */
export type ResumeAnswerHandler = (answer: string) => void | Promise<void>;
const resumeHandler = shallowRef<ResumeAnswerHandler | null>(null);

export function setResumeHandler(h: ResumeAnswerHandler | null): void {
  resumeHandler.value = h;
}

export function getResumeHandler(): ResumeAnswerHandler | null {
  return resumeHandler.value;
}

export function hasPendingResume(): boolean {
  return resumeHandler.value !== null;
}

/**
 * Append a non-streaming line. Delegates to the terminal store so the write
 * goes through the debounced IDB persistence layer. Returns the reactive line
 * for callers that want to mutate it later (but see `pushProgress` /
 * `beginChatReply` for lines expected to mutate).
 */
export function print(text: string, kind: LineKind = "out"): ScrollbackLine {
  const line = reactive<ScrollbackLine>({ id: _nextLineId(), kind, text });
  useTerminalStore().pushLine(line);
  return line;
}

export function printLines(lines: string[], kind: LineKind = "out"): void {
  for (const l of lines) print(l, kind);
}

/**
 * Progress line. The returned reactive can have its `.text` / `.progress`
 * mutated in place by callers. The store holds off on persisting it until
 * `finishProgress()` is called or `.progress` reaches 1 (caller-driven).
 */
export function pushProgress(initialText: string): ScrollbackLine {
  const line = reactive<ScrollbackLine>({
    id: _nextLineId(),
    kind: "progress",
    text: initialText,
    progress: 0,
  });
  useTerminalStore().pushLine(line);
  return line;
}

/**
 * Finalize a progress line for persistence. Call this when the progress hits
 * 1 (or when the operation otherwise concludes). Idempotent — safe to call
 * for a line that was already finalized.
 */
export function finishProgress(line: ScrollbackLine): void {
  useTerminalStore().finalizeStreamingLine(line);
}

export async function clearScrollback(): Promise<void> {
  await useTerminalStore().clearScrollback();
}

export function beginChatReply(): ScrollbackLine {
  const line = reactive<ScrollbackLine>({
    id: _nextLineId(),
    kind: "chat-reply",
    text: "",
    streaming: true,
  });
  useTerminalStore().pushLine(line);
  return line;
}

/**
 * Call when a chat-reply stream ends (streaming flipped to false). Takes the
 * snapshot and enqueues the line for IDB persistence.
 */
export function finishChatReply(line: ScrollbackLine): void {
  useTerminalStore().finalizeStreamingLine(line);
}
