import { defineStore } from "pinia";
import { computed, ref } from "vue";
import type { IDBPDatabase } from "idb";
import { openSessionDb, type PersistedChatSession, type SessionDbSchema } from "@/storage/db";
import { findEngram } from "@/engrams";
import type { ChatHistoryEntry } from "@/terminal/session";

const SCHEMA_VERSION = 1 as const;
const PERSIST_DEBOUNCE_MS = 250;
const SESSION_KEY = "current";

/**
 * Human-friendly relative-time formatter for the resume-prompt.
 * Kept deliberately tiny — we don't need Intl.RelativeTimeFormat's localization
 * surface for a single in-world English prompt.
 */
const formatTimeAgo = (thenMs: number, nowMs: number = Date.now()): string => {
  const diffSec = Math.max(0, Math.round((nowMs - thenMs) / 1000));
  if (diffSec < 30) return "just now";
  if (diffSec < 60) return `${diffSec} seconds ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? "" : "s"} ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hour${diffHr === 1 ? "" : "s"} ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay} day${diffDay === 1 ? "" : "s"} ago`;
};

/**
 * Chat store — in-flight conversation state with IDB persistence (single record
 * under `"current"` in the `chat-session` store).
 *
 * Persistence strategy: `$subscribe` → trailing-edge 250ms debounce → `persist()`.
 * Writes the full record on each flush. Records are small (just chat history +
 * a few ids) so a batched coalesced write is simpler than diffing.
 *
 * Schema-version mismatch on hydrate → graceful discard, state stays empty, we
 * do NOT persist the empty state back (leaving the stale record in place for
 * a potential later migration). After the user answers `n` at the resume
 * prompt — or on mismatch surfacing as "no prior session" — the App-level
 * handler calls `clear()` which explicitly wipes the IDB record.
 */
export const useChatStore = defineStore("chat", () => {
  const chatHistory = ref<ChatHistoryEntry[]>([]);
  const firmwareId = ref<string | null>(null);
  const engramId = ref<string | null>(null);
  const startedAt = ref<number>(0);
  const lastTurnAt = ref<number>(0);

  // Set to true after a successful hydrate (valid or empty record). Controls
  // whether the $subscribe flushes — we don't want mutations during hydration
  // to bounce back into IDB.
  let hydrated = false;
  let subscribed = false;
  let persistTimer: ReturnType<typeof setTimeout> | null = null;

  function ensureSubscribed(): void {
    if (subscribed) return;
    subscribed = true;
    // Late-bound: `this.$subscribe` isn't usable inside a setup store directly,
    // so we reach through the active pinia to reattach. This runs at most once
    // per store lifetime.
    const store = useChatStore();
    store.$subscribe(() => {
      schedulePersist();
    });
  }

  async function hydrate(): Promise<void> {
    let db: IDBPDatabase<SessionDbSchema>;
    try {
      db = await openSessionDb();
    } catch (err) {
      console.warn("[chat] hydrate: openSessionDb failed", err);
      hydrated = true;
      return;
    }
    try {
      const rec = await db.get("chat-session", SESSION_KEY);
      if (!rec) {
        // Nothing persisted yet — normal first-run.
      } else if (rec.schemaVersion !== SCHEMA_VERSION) {
        console.warn(
          `[chat] hydrate: discarding chat-session with schemaVersion ${rec.schemaVersion} (expected ${SCHEMA_VERSION})`,
        );
        // Don't persist back — leave the stale record for potential future
        // migration, but show an empty state to the user.
      } else {
        chatHistory.value = Array.isArray(rec.chatHistory) ? rec.chatHistory.slice() : [];
        firmwareId.value = rec.firmwareId ?? null;
        engramId.value = rec.engramId ?? null;
        startedAt.value = typeof rec.startedAt === "number" ? rec.startedAt : 0;
        lastTurnAt.value = typeof rec.lastTurnAt === "number" ? rec.lastTurnAt : 0;
      }
    } catch (err) {
      console.warn("[chat] hydrate: read failed", err);
    } finally {
      db.close();
      hydrated = true;
      ensureSubscribed();
    }
  }

  async function persist(): Promise<void> {
    const record: PersistedChatSession = {
      schemaVersion: SCHEMA_VERSION,
      chatHistory: chatHistory.value.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      firmwareId: firmwareId.value,
      engramId: engramId.value,
      startedAt: startedAt.value,
      lastTurnAt: lastTurnAt.value,
    };
    let db: IDBPDatabase<SessionDbSchema>;
    try {
      db = await openSessionDb();
    } catch (err) {
      console.warn("[chat] persist: openSessionDb failed", err);
      return;
    }
    try {
      await db.put("chat-session", record, SESSION_KEY);
    } catch (err) {
      console.warn("[chat] persist: write failed", err);
    } finally {
      db.close();
    }
  }

  function schedulePersist(): void {
    if (!hydrated) return; // suppress during hydrate
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      persistTimer = null;
      void persist();
    }, PERSIST_DEBOUNCE_MS);
  }

  function appendTurn(role: "user" | "assistant", content: string): void {
    const now = Date.now();
    if (startedAt.value === 0) startedAt.value = now;
    lastTurnAt.value = now;
    chatHistory.value.push({ role, content });
  }

  async function clear(): Promise<void> {
    chatHistory.value = [];
    firmwareId.value = null;
    engramId.value = null;
    startedAt.value = 0;
    lastTurnAt.value = 0;
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    let db: IDBPDatabase<SessionDbSchema>;
    try {
      db = await openSessionDb();
    } catch (err) {
      console.warn("[chat] clear: openSessionDb failed", err);
      return;
    }
    try {
      await db.delete("chat-session", SESSION_KEY);
    } catch (err) {
      console.warn("[chat] clear: delete failed", err);
    } finally {
      db.close();
    }
  }

  const hasPriorSession = computed<boolean>(
    () => chatHistory.value.length > 0 && firmwareId.value !== null && engramId.value !== null,
  );

  const summary = computed<{
    handle: string;
    turns: number;
    timeAgo: string;
  } | null>(() => {
    if (!hasPriorSession.value) return null;
    const eg = engramId.value ? findEngram(engramId.value) : null;
    const handle = eg?.handle ?? engramId.value ?? "unknown";
    const turns = chatHistory.value.filter((m) => m.role === "user").length;
    const timeAgo = lastTurnAt.value > 0 ? formatTimeAgo(lastTurnAt.value) : "just now";
    return { handle, turns, timeAgo };
  });

  return {
    chatHistory,
    firmwareId,
    engramId,
    startedAt,
    lastTurnAt,
    hydrate,
    appendTurn,
    persist,
    clear,
    hasPriorSession,
    summary,
    schedulePersist,
  };
});
