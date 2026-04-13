import { ref } from "vue";
import type { RetrievedChunk } from "opensona/runtime";

const STORAGE_KEY = "mikoshi.rag.log";
const MAX_ENTRIES = 200;

export interface RagLogEntry {
  id: number;
  timestamp: number;
  query: string;
  engramId: string | null;
  cutoffEventId: string | null;
  chunks: RetrievedChunk[];
}

function loadFromStorage(): RagLogEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as RagLogEntry[]) : [];
  } catch {
    return [];
  }
}

function saveToStorage(entries: RagLogEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch (err) {
    console.warn("[ragLog] persist failed:", err);
  }
}

export const ragLog = ref<RagLogEntry[]>(loadFromStorage());

let seq = ragLog.value.reduce((m, e) => Math.max(m, e.id), 0);

export function appendRagLog(entry: Omit<RagLogEntry, "id" | "timestamp">): void {
  const full: RagLogEntry = {
    id: ++seq,
    timestamp: Date.now(),
    ...entry,
  };
  ragLog.value = [full, ...ragLog.value].slice(0, MAX_ENTRIES);
  saveToStorage(ragLog.value);
}

export function clearRagLog(): void {
  ragLog.value = [];
  saveToStorage(ragLog.value);
}

export function exportRagLogJson(): string {
  return JSON.stringify(ragLog.value, null, 2);
}
