import { reactive, ref, shallowRef } from "vue";
import type { MLCEngineInterface } from "@mlc-ai/web-llm";
import type { Engram } from "@/engrams";
import type { Firmware } from "@/firmware";

export type LineKind =
  | "out" // plain output
  | "cmd" // echoed user command
  | "info" // informational
  | "warn" // warning
  | "error" // error
  | "banner" // ASCII banner / special
  | "progress" // live-updating progress bar
  | "chat-user" // user message while in chat mode
  | "chat-reply"; // streaming engram reply

export interface ScrollbackLine {
  id: number;
  kind: LineKind;
  text: string;
  /** for progress lines: current ratio 0..1 */
  progress?: number;
  /** flag for chat-reply lines that are still streaming */
  streaming?: boolean;
}

export type Mode = "shell" | "chat" | "loading";

export interface ChatHistoryEntry {
  role: "user" | "assistant";
  content: string;
}

export interface Session {
  scrollback: ScrollbackLine[];
  mode: Mode;
  theme: string;
  currentEngram: Engram | null;
  currentFirmware: Firmware | null;
  chatHistory: ChatHistoryEntry[];
}

let lineSeq = 0;
const nextId = (): number => ++lineSeq;

export const session = reactive<Session>({
  scrollback: [],
  mode: "shell",
  theme: "arasaka",
  currentEngram: null,
  currentFirmware: null,
  chatHistory: [],
});

// Engine lives outside reactive state so Vue does not try to proxy it.
export const engineRef = shallowRef<MLCEngineInterface | null>(null);

// Input focus trigger for Terminal.vue
export const focusInput = ref(0);

export function print(text: string, kind: LineKind = "out"): ScrollbackLine {
  const line: ScrollbackLine = { id: nextId(), kind, text };
  session.scrollback.push(line);
  return line;
}

export function printLines(lines: string[], kind: LineKind = "out"): void {
  for (const l of lines) print(l, kind);
}

export function pushProgress(initialText: string): ScrollbackLine {
  // Must be reactive() — callers mutate `.text` / `.progress` in-place to
  // drive a live progress bar, and Vue's Proxy traps only fire when those
  // writes go through the reactive proxy, not the raw target.
  const line = reactive<ScrollbackLine>({
    id: nextId(),
    kind: "progress",
    text: initialText,
    progress: 0,
  });
  session.scrollback.push(line);
  return line;
}

export function clearScrollback(): void {
  session.scrollback.length = 0;
}

export function beginChatReply(): ScrollbackLine {
  // Reactive for the same reason as pushProgress: streamReply mutates
  // `.text` and `.streaming` in-place as tokens arrive.
  const line = reactive<ScrollbackLine>({
    id: nextId(),
    kind: "chat-reply",
    text: "",
    streaming: true,
  });
  session.scrollback.push(line);
  return line;
}
