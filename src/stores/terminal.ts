import { defineStore } from "pinia";
import { computed, reactive, ref } from "vue";
import { openSessionDb, type PersistedScrollbackLine, type SessionDbSchema } from "@/storage/db";
import type { IDBPDatabase } from "idb";

const MAX_COMMANDS = 1000;
const SCHEMA_VERSION = 1;

/** Per PLAN §5. */
const MAX_LINES = 10_000;
const PAGE_SIZE = 500;
const FLUSH_DEBOUNCE_MS = 100;

export type LineKind =
  | "out"
  | "cmd"
  | "info"
  | "warn"
  | "error"
  | "banner"
  | "progress"
  | "chat-user"
  | "chat-reply";

export type ScrollbackLine = {
  id: number;
  kind: LineKind;
  text: string;
  progress?: number;
  streaming?: boolean;
};

// In-memory line id sequence — monotonically increasing, unrelated to the IDB
// autoinc id. Used as the Vue :key for rendering.
let lineSeq = 0;
/** Next line id. */
const nextLineId = (): number => {
  return ++lineSeq;
};

/**
 * Terminal store — owns shell command history, arrow-nav state, and scrollback.
 *
 * commandHistory lives in localStorage (via the pinia persist plugin); the
 * scrollback itself goes through a manual IDB layer because it's unbounded in
 * count and churn-heavy. The plugin's `persist.pick` keeps its hands off the
 * scrollback reactive.
 */
export const useTerminalStore = defineStore(
  "terminal",
  () => {
    // Persisted (via plugin → localStorage).
    const commandHistory = ref<string[]>([]);
    const schemaVersion = ref<number>(SCHEMA_VERSION);

    // Runtime-only.
    const historyIndex = ref<number>(0);
    const draft = ref<string>("");

    // Scrollback — in-memory tail window. Held in a reactive array; append
    // and splice both go through Vue so the template reacts.
    const scrollback = reactive<ScrollbackLine[]>([]);
    // Expose a computed so consumers have a single obvious read path.
    const visibleLines = computed<ScrollbackLine[]>(() => scrollback);

    // Pagination cursors. `oldestLoadedId` is the IDB id of the oldest
    // persisted record currently held in memory (null if nothing persisted
    // is loaded — e.g. empty DB or only streaming lines in flight).
    const oldestLoadedId = ref<number | null>(null);
    const canLoadEarlier = ref<boolean>(false);

    // Lines that have been pushed to the UI but are not yet eligible to be
    // persisted (streaming chat-reply or in-flight progress). Tracked by
    // identity — we compare the reactive object reference against what's
    // still sitting in `scrollback` when deciding whether to snapshot.
    const pendingFinalization = new WeakSet<ScrollbackLine>();

    // Map in-memory line → persisted IDB id once it's been written. Used to
    // avoid double-persisting and to keep `oldestLoadedId` accurate if we
    // ever evict a line from memory whose persistence is still resolving.
    const persistedIdFor = new WeakMap<ScrollbackLine, number>();

    // Debounced write queue. Holds copies (not references) of lines to flush
    // next tick; snapshot-before-write is baked into the enqueue step.
    let pendingWrites: PersistedScrollbackLine[] = [];
    // The in-memory lines matched 1:1 with pendingWrites, in the same order,
    // so we can backfill their assigned ids after the flush resolves.
    let pendingWriteTargets: ScrollbackLine[] = [];
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    function init(): void {
      if (schemaVersion.value !== SCHEMA_VERSION) {
        commandHistory.value = [];
        schemaVersion.value = SCHEMA_VERSION;
      }
      historyIndex.value = commandHistory.value.length;
      draft.value = "";
    }

    // --- Command history (unchanged from Step 4) ---------------------------

    function recordCommand(cmd: string): void {
      const trimmed = cmd.trim();
      if (!trimmed) return;
      const last = commandHistory.value[commandHistory.value.length - 1];
      if (last !== trimmed) {
        commandHistory.value.push(trimmed);
        if (commandHistory.value.length > MAX_COMMANDS) {
          commandHistory.value.splice(0, commandHistory.value.length - MAX_COMMANDS);
        }
      }
      historyIndex.value = commandHistory.value.length;
      draft.value = "";
    }

    function navigatePrev(currentInput: string): string {
      if (commandHistory.value.length === 0) return currentInput;
      if (historyIndex.value === commandHistory.value.length) {
        draft.value = currentInput;
      }
      if (historyIndex.value > 0) {
        historyIndex.value -= 1;
      }
      return commandHistory.value[historyIndex.value] ?? "";
    }

    function navigateNext(): string {
      if (historyIndex.value >= commandHistory.value.length) {
        historyIndex.value = commandHistory.value.length;
        return draft.value;
      }
      historyIndex.value += 1;
      if (historyIndex.value >= commandHistory.value.length) {
        return draft.value;
      }
      return commandHistory.value[historyIndex.value] ?? "";
    }

    function resetNav(): void {
      historyIndex.value = commandHistory.value.length;
      draft.value = "";
    }

    function snapshot(line: ScrollbackLine): PersistedScrollbackLine {
      // Snapshot-before-write per PLAN §2: fix streaming=false, progress=1 (or
      // whatever finalized progress the line carried), strip reactivity by
      // copying primitive fields into a fresh plain object. The write goes to
      // IDB via structured clone, so a plain object is mandatory.
      const rec: PersistedScrollbackLine = {
        schemaVersion: 1,
        kind: line.kind,
        text: line.text,
        timestamp: Date.now(),
      };
      if (line.kind === "progress") {
        rec.progress = line.progress ?? 1;
      }
      return rec;
    }

    function enqueueWrite(line: ScrollbackLine): void {
      if (persistedIdFor.has(line)) return; // already written
      if (pendingFinalization.has(line)) return; // streaming / in-progress
      pendingWrites.push(snapshot(line));
      pendingWriteTargets.push(line);
      scheduleFlush();
    }

    function scheduleFlush(): void {
      if (flushTimer) return;
      flushTimer = setTimeout(() => {
        flushTimer = null;
        void flushWrites();
      }, FLUSH_DEBOUNCE_MS);
    }

    async function flushWrites(): Promise<void> {
      if (pendingWrites.length === 0) return;
      const batch = pendingWrites;
      const targets = pendingWriteTargets;
      pendingWrites = [];
      pendingWriteTargets = [];
      let db: IDBPDatabase<SessionDbSchema>;
      try {
        db = await openSessionDb();
      } catch (err) {
        console.warn("[terminal] scrollback flush: openSessionDb failed", err);
        return;
      }
      try {
        const tx = db.transaction("scrollback", "readwrite");
        const store = tx.objectStore("scrollback");
        const ids: number[] = [];
        for (const rec of batch) {
          const id = await store.add(rec);
          ids.push(id as number);
        }
        await tx.done;
        for (let i = 0; i < targets.length; i++) {
          const t = targets[i];
          const id = ids[i];
          if (t && typeof id === "number") {
            persistedIdFor.set(t, id);
            // First-ever record: seed oldestLoadedId so load-earlier knows
            // where to anchor.
            if (oldestLoadedId.value === null) oldestLoadedId.value = id;
          }
        }
      } catch (err) {
        console.warn("[terminal] scrollback flush: transaction failed", err);
      } finally {
        db.close();
      }
    }

    async function hydrateScrollback(): Promise<void> {
      let db: IDBPDatabase<SessionDbSchema>;
      try {
        db = await openSessionDb();
      } catch (err) {
        console.warn("[terminal] hydrateScrollback: openSessionDb failed", err);
        return;
      }
      try {
        // Walk the by-timestamp index in reverse to grab the newest PAGE_SIZE
        // records. These are the "tail window" shown on mount.
        const tx = db.transaction("scrollback", "readonly");
        const index = tx.objectStore("scrollback").index("by-timestamp");
        const collected: PersistedScrollbackLine[] = [];
        let discardedCount = 0;
        let cursor = await index.openCursor(null, "prev");
        while (cursor && collected.length < PAGE_SIZE) {
          const v = cursor.value;
          if (v.schemaVersion !== 1) {
            discardedCount++;
          } else {
            collected.push(v);
          }
          cursor = await cursor.continue();
        }
        // Check whether more records exist beyond what we collected — used to
        // light up `canLoadEarlier`.
        const remaining = cursor !== null;
        await tx.done;

        // `collected` is newest-first; flip to chronological for display.
        collected.reverse();
        scrollback.length = 0;
        let minId: number | null = null;
        for (const rec of collected) {
          const line = reactive<ScrollbackLine>({
            id: nextLineId(),
            kind: rec.kind as LineKind,
            text: rec.text,
            ...(rec.progress !== undefined ? { progress: rec.progress } : {}),
          });
          scrollback.push(line);
          if (rec.id !== undefined) {
            persistedIdFor.set(line, rec.id);
            if (minId === null || rec.id < minId) minId = rec.id;
          }
        }
        oldestLoadedId.value = minId;
        canLoadEarlier.value = remaining && minId !== null;

        if (discardedCount > 0) {
          // User-facing notice per PLAN §2. Push directly — don't route through
          // enqueueWrite here because we don't want to re-persist.
          const note = reactive<ScrollbackLine>({
            id: nextLineId(),
            kind: "warn",
            text: `some prior scrollback was discarded due to schema mismatch (${discardedCount} record(s))`,
          });
          scrollback.push(note);
          // This notice IS a new event worth persisting so the user sees the
          // same warning on the next refresh too.
          enqueueWrite(note);
        }
      } catch (err) {
        console.warn("[terminal] hydrateScrollback: read failed", err);
      } finally {
        db.close();
      }
    }

    async function loadEarlierPage(): Promise<void> {
      if (!canLoadEarlier.value) return;
      if (oldestLoadedId.value === null) return;
      let db: IDBPDatabase<SessionDbSchema>;
      try {
        db = await openSessionDb();
      } catch (err) {
        console.warn("[terminal] loadEarlierPage: openSessionDb failed", err);
        return;
      }
      try {
        const tx = db.transaction("scrollback", "readonly");
        const store = tx.objectStore("scrollback");
        // IDs are strictly ascending under autoincrement, so walking the
        // primary-key range backward from oldestLoadedId-1 gives us the
        // previous page in reverse-chronological order.
        const upper = oldestLoadedId.value - 1;
        if (upper < 0) {
          canLoadEarlier.value = false;
          await tx.done;
          return;
        }
        const range = IDBKeyRange.upperBound(upper);
        const collected: PersistedScrollbackLine[] = [];
        let cursor = await store.openCursor(range, "prev");
        while (cursor && collected.length < PAGE_SIZE) {
          const v = cursor.value;
          if (v.schemaVersion === 1) collected.push(v);
          cursor = await cursor.continue();
        }
        const remaining = cursor !== null;
        await tx.done;

        collected.reverse();
        let minId: number | null = oldestLoadedId.value;
        const prepended: ScrollbackLine[] = [];
        for (const rec of collected) {
          const line = reactive<ScrollbackLine>({
            id: nextLineId(),
            kind: rec.kind as LineKind,
            text: rec.text,
            ...(rec.progress !== undefined ? { progress: rec.progress } : {}),
          });
          prepended.push(line);
          if (rec.id !== undefined) {
            persistedIdFor.set(line, rec.id);
            if (minId === null || rec.id < minId) minId = rec.id;
          }
        }
        scrollback.unshift(...prepended);
        oldestLoadedId.value = minId;
        canLoadEarlier.value = remaining;

        // Window cap: when total > PAGE_SIZE*2, drop the trailing (most
        // recent) overflow the user scrolled away from. The user is looking
        // at older history; the newest lines will reappear on the next
        // append or via re-hydrate on refresh.
        const cap = PAGE_SIZE * 2;
        if (scrollback.length > cap) {
          const overflow = scrollback.length - cap;
          scrollback.splice(scrollback.length - overflow, overflow);
        }
      } catch (err) {
        console.warn("[terminal] loadEarlierPage: read failed", err);
      } finally {
        db.close();
      }
    }

    function pushLine(line: ScrollbackLine): ScrollbackLine {
      scrollback.push(line);
      if (scrollback.length > MAX_LINES) {
        scrollback.splice(0, scrollback.length - MAX_LINES);
      }
      if (line.streaming === true) {
        pendingFinalization.add(line);
      } else if (line.kind === "progress" && (line.progress ?? 0) < 1) {
        pendingFinalization.add(line);
      } else {
        enqueueWrite(line);
      }
      return line;
    }

    function finalizeStreamingLine(line: ScrollbackLine): void {
      if (!pendingFinalization.has(line)) return;
      pendingFinalization.delete(line);
      // Fix terminal shape for the snapshot. For a progress line that settled
      // below 1 we still record whatever final ratio it carried.
      if (line.streaming) line.streaming = false;
      enqueueWrite(line);
    }

    async function clearScrollback(): Promise<void> {
      scrollback.length = 0;
      oldestLoadedId.value = null;
      canLoadEarlier.value = false;
      // Drop any pending writes so we don't re-seed the store after wiping.
      pendingWrites = [];
      pendingWriteTargets = [];
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      let db: IDBPDatabase<SessionDbSchema>;
      try {
        db = await openSessionDb();
      } catch (err) {
        console.warn("[terminal] clearScrollback: openSessionDb failed", err);
        return;
      }
      try {
        await db.clear("scrollback");
      } catch (err) {
        console.warn("[terminal] clearScrollback: clear failed", err);
      } finally {
        db.close();
      }
    }

    init();

    return {
      commandHistory,
      historyIndex,
      draft,
      schemaVersion,
      scrollback,
      visibleLines,
      oldestLoadedId,
      canLoadEarlier,
      recordCommand,
      navigatePrev,
      navigateNext,
      resetNav,
      pushLine,
      finalizeStreamingLine,
      hydrateScrollback,
      loadEarlierPage,
      clearScrollback,
    };
  },
  {
    persist: {
      key: "mikoshi.terminal",
      storage: {
        getItem: (k: string): string | null =>
          typeof localStorage !== "undefined" ? localStorage.getItem(k) : null,
        setItem: (k: string, v: string): void => {
          if (typeof localStorage !== "undefined") localStorage.setItem(k, v);
        },
      },
      pick: ["commandHistory", "schemaVersion"],
    },
  },
);

/** Re-exported so test helpers can synthesize new in-memory lines. */
export const _nextLineId = (): number => {
  return nextLineId();
};
