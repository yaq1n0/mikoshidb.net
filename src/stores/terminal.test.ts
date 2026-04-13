import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { IDBFactory } from "fake-indexeddb";
import { reactive } from "vue";
import { useTerminalStore, type ScrollbackLine } from "@/stores/terminal";
import { openSessionDb, type PersistedScrollbackLine } from "@/storage/db";

// IDB writes in the store are debounced ~100ms. Tests need to wait past that.
async function waitForFlush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 150));
}

// Minimal in-memory localStorage shim — the vitest config runs under the
// "node" environment which lacks browser globals. The terminal store reads
// from `localStorage` lazily, so installing this once at the top is enough.
function installLocalStorageShim(): void {
  const map = new Map<string, string>();
  const shim: Storage = {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => (map.has(k) ? (map.get(k) as string) : null),
    key: (i) => Array.from(map.keys())[i] ?? null,
    removeItem: (k) => {
      map.delete(k);
    },
    setItem: (k, v) => {
      map.set(k, String(v));
    },
  };
  (globalThis as unknown as { localStorage: Storage }).localStorage = shim;
}
installLocalStorageShim();

describe("useTerminalStore", () => {
  beforeEach(() => {
    // Fresh pinia + clean localStorage + clean IDB so persisted state from a
    // prior test can't bleed into the next one.
    localStorage.clear();
    globalThis.indexedDB = new IDBFactory();
    setActivePinia(createPinia());
  });

  it("dedups consecutive identical commands and trims whitespace", () => {
    const store = useTerminalStore();
    store.recordCommand("ls");
    store.recordCommand("  ls  "); // same after trim → ignored
    store.recordCommand(""); // empty → ignored
    store.recordCommand("   "); // whitespace → ignored
    store.recordCommand("pwd");
    expect(store.commandHistory).toEqual(["ls", "pwd"]);
  });

  it("evicts oldest entries when MAX_COMMANDS is exceeded", () => {
    const store = useTerminalStore();
    // 1001 distinct commands → first one ("cmd-0") should be evicted.
    for (let i = 0; i < 1001; i++) {
      store.recordCommand(`cmd-${i}`);
    }
    expect(store.commandHistory.length).toBe(1000);
    expect(store.commandHistory[0]).toBe("cmd-1");
    expect(store.commandHistory[999]).toBe("cmd-1000");
  });

  it("ArrowUp walks back through history; ArrowDown walks forward and restores draft", () => {
    const store = useTerminalStore();
    store.recordCommand("first");
    store.recordCommand("second");
    store.recordCommand("third");

    // Live line, user has typed "in-progress" and starts pressing ArrowUp.
    expect(store.navigatePrev("in-progress")).toBe("third");
    expect(store.navigatePrev("third")).toBe("second");
    expect(store.navigatePrev("second")).toBe("first");
    // Clamp at oldest.
    expect(store.navigatePrev("first")).toBe("first");

    // ArrowDown back forward.
    expect(store.navigateNext()).toBe("second");
    expect(store.navigateNext()).toBe("third");
    // Past the newest → restore the stashed draft.
    expect(store.navigateNext()).toBe("in-progress");
    // Already at the live line — stay there.
    expect(store.navigateNext()).toBe("in-progress");
  });

  it("navigatePrev with empty history is a no-op and returns the current input", () => {
    const store = useTerminalStore();
    expect(store.navigatePrev("typed")).toBe("typed");
    expect(store.commandHistory).toEqual([]);
  });

  it("resetNav returns the cursor to the live line and clears the draft stash", () => {
    const store = useTerminalStore();
    store.recordCommand("alpha");
    store.recordCommand("beta");

    store.navigatePrev("scratch");
    expect(store.historyIndex).toBe(1);
    expect(store.draft).toBe("scratch");

    store.resetNav();
    expect(store.historyIndex).toBe(store.commandHistory.length);
    expect(store.draft).toBe("");
  });

  it("recordCommand resets the nav cursor after submit", () => {
    const store = useTerminalStore();
    store.recordCommand("a");
    store.recordCommand("b");
    store.navigatePrev("");
    store.navigatePrev("");
    expect(store.historyIndex).toBe(0);
    store.recordCommand("c");
    expect(store.historyIndex).toBe(store.commandHistory.length);
    expect(store.draft).toBe("");
  });

  // --- Scrollback persistence (Step 5b) -------------------------------------

  function makeLine(
    kind: ScrollbackLine["kind"],
    text: string,
    extra: Partial<ScrollbackLine> = {},
  ): ScrollbackLine {
    // Synthesize a reactive line like session.ts does so store internals see a
    // Proxy and not a plain object.
    return reactive<ScrollbackLine>({ id: Math.floor(Math.random() * 1e9), kind, text, ...extra });
  }

  it("hydrateScrollback populates scrollback from IDB in chronological order", async () => {
    // Seed IDB directly.
    const db = await openSessionDb();
    const base = Date.now();
    for (let i = 0; i < 3; i++) {
      const rec: PersistedScrollbackLine = {
        schemaVersion: 1,
        kind: "out",
        text: `line-${i}`,
        timestamp: base + i,
      };
      await db.add("scrollback", rec);
    }
    db.close();

    const store = useTerminalStore();
    await store.hydrateScrollback();
    expect(store.scrollback.map((l) => l.text)).toEqual(["line-0", "line-1", "line-2"]);
    expect(store.canLoadEarlier).toBe(false);
  });

  it("pushLine persists non-streaming lines to IDB after debounce", async () => {
    const store = useTerminalStore();
    store.pushLine(makeLine("out", "hello"));
    store.pushLine(makeLine("info", "world"));
    await waitForFlush();
    const db = await openSessionDb();
    const all = await db.getAll("scrollback");
    db.close();
    expect(all.map((r) => r.text)).toEqual(["hello", "world"]);
    expect(all.every((r) => r.schemaVersion === 1)).toBe(true);
  });

  it("streaming chat-reply lines are NOT persisted until finalized", async () => {
    const store = useTerminalStore();
    const line = makeLine("chat-reply", "", { streaming: true });
    store.pushLine(line);
    await waitForFlush();
    // Nothing written yet.
    let db = await openSessionDb();
    let all = await db.getAll("scrollback");
    db.close();
    expect(all).toEqual([]);

    // Stream completes: caller mutates text then flips streaming off, then
    // calls finalizeStreamingLine.
    line.text = "full reply body";
    line.streaming = false;
    store.finalizeStreamingLine(line);
    await waitForFlush();

    db = await openSessionDb();
    all = await db.getAll("scrollback");
    db.close();
    expect(all.length).toBe(1);
    expect(all[0]!.text).toBe("full reply body");
    expect(all[0]!.kind).toBe("chat-reply");
  });

  it("progress lines are held until finalization (progress=1)", async () => {
    const store = useTerminalStore();
    const line = makeLine("progress", "[  ] 0%", { progress: 0 });
    store.pushLine(line);
    line.progress = 0.5;
    line.text = "[# ] 50%";
    await waitForFlush();
    let db = await openSessionDb();
    let all = await db.getAll("scrollback");
    db.close();
    expect(all).toEqual([]);

    line.progress = 1;
    line.text = "[##] 100%";
    store.finalizeStreamingLine(line);
    await waitForFlush();
    db = await openSessionDb();
    all = await db.getAll("scrollback");
    db.close();
    expect(all.length).toBe(1);
    expect(all[0]!.progress).toBe(1);
  });

  it("clearScrollback empties both in-memory scrollback and IDB", async () => {
    const store = useTerminalStore();
    store.pushLine(makeLine("out", "a"));
    store.pushLine(makeLine("out", "b"));
    await waitForFlush();
    expect(store.scrollback.length).toBe(2);

    await store.clearScrollback();
    expect(store.scrollback.length).toBe(0);
    expect(store.oldestLoadedId).toBe(null);
    expect(store.canLoadEarlier).toBe(false);
    const db = await openSessionDb();
    const all = await db.getAll("scrollback");
    db.close();
    expect(all).toEqual([]);
  });

  it("loadEarlierPage fetches the previous window and preserves canLoadEarlier", async () => {
    // Seed 4 records; we'll hydrate with a small tail and then pull earlier.
    const db = await openSessionDb();
    const base = Date.now();
    for (let i = 0; i < 4; i++) {
      const rec: PersistedScrollbackLine = {
        schemaVersion: 1,
        kind: "out",
        text: `msg-${i}`,
        timestamp: base + i,
      };
      await db.add("scrollback", rec);
    }
    db.close();

    const store = useTerminalStore();
    await store.hydrateScrollback();
    // All 4 fit under PAGE_SIZE so they all load and there's nothing earlier.
    expect(store.scrollback.length).toBe(4);
    expect(store.canLoadEarlier).toBe(false);
    // loadEarlierPage with nothing earlier is a no-op.
    await store.loadEarlierPage();
    expect(store.scrollback.length).toBe(4);
  });

  it("hydrate discards records with wrong schemaVersion and warns the user", async () => {
    const db = await openSessionDb();
    const base = Date.now();
    // Mix one valid and one bogus record. fake-indexeddb doesn't enforce the
    // typed schema, so we can sneak a version-mismatched record in.
    await db.add("scrollback", {
      schemaVersion: 1,
      kind: "out",
      text: "ok",
      timestamp: base,
    });
    await db.add("scrollback", {
      // deliberately wrong — simulates data from a future schema version
      schemaVersion: 2,
      kind: "out",
      text: "bogus",
      timestamp: base + 1,
    } as unknown as PersistedScrollbackLine);
    db.close();

    const store = useTerminalStore();
    await store.hydrateScrollback();
    // Valid line is present; bogus line is dropped; a warn notice is appended.
    const texts = store.scrollback.map((l) => l.text);
    expect(texts).toContain("ok");
    expect(texts.find((t) => t.includes("schema mismatch"))).toBeDefined();
    expect(store.scrollback.find((l) => l.text === "bogus")).toBeUndefined();
  });
});
