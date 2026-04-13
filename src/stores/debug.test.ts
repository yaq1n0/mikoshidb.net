import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import piniaPluginPersistedstate from "pinia-plugin-persistedstate";
import { useDebugStore, MIN_W, MAX_W } from "@/stores/debug";

// Minimal localStorage shim — vitest config runs under "node" environment so
// browser globals are absent. The pinia persistedstate plugin reads/writes to
// `localStorage` synchronously on hydration and on each mutation.
/** Install local storage shim. */
const installLocalStorageShim = (): void => {
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
};
installLocalStorageShim();

/** Fresh pinia. */
const freshPinia = (): void => {
  const pinia = createPinia();
  pinia.use(piniaPluginPersistedstate);
  setActivePinia(pinia);
};

describe("useDebugStore", () => {
  beforeEach(() => {
    localStorage.clear();
    freshPinia();
  });

  it("starts with sensible defaults", () => {
    const store = useDebugStore();
    expect(store.activeTab).toBe("rag");
    expect(store.debugWidth).toBe(400);
    expect(store.expandedEntries).toEqual({});
    expect(store.expandedTexts).toEqual({});
  });

  it("setActiveTab switches the active tab", () => {
    const store = useDebugStore();
    store.setActiveTab("prompts");
    expect(store.activeTab).toBe("prompts");
    store.setActiveTab("session");
    expect(store.activeTab).toBe("session");
  });

  it("setWidth clamps to [MIN_W, MAX_W]", () => {
    const store = useDebugStore();
    store.setWidth(50); // below min
    expect(store.debugWidth).toBe(MIN_W);
    store.setWidth(9999); // above max
    expect(store.debugWidth).toBe(MAX_W);
    store.setWidth(500); // in range
    expect(store.debugWidth).toBe(500);
  });

  it("toggleEntry / isEntryExpanded round-trip", () => {
    const store = useDebugStore();
    expect(store.isEntryExpanded(7)).toBe(false);
    store.toggleEntry(7);
    expect(store.isEntryExpanded(7)).toBe(true);
    store.toggleEntry(7);
    expect(store.isEntryExpanded(7)).toBe(false);
  });

  it("toggleText / isTextExpanded round-trip", () => {
    const store = useDebugStore();
    const k = "12:preamble";
    expect(store.isTextExpanded(k)).toBe(false);
    store.toggleText(k);
    expect(store.isTextExpanded(k)).toBe(true);
    store.toggleText(k);
    expect(store.isTextExpanded(k)).toBe(false);
  });

  it("schemaVersion mismatch on hydrate resets to defaults", () => {
    // Pre-seed localStorage with a record carrying a future schema version and
    // a clearly out-of-band width / activeTab. The store's init() should
    // discard the lot and reset to defaults.
    localStorage.setItem(
      "mikoshi.debug",
      JSON.stringify({
        debugWidth: 700,
        activeTab: "session",
        expandedEntries: { "1": true },
        expandedTexts: { "1:preamble": true },
        schemaVersion: 999,
      }),
    );
    freshPinia();
    const store = useDebugStore();
    expect(store.activeTab).toBe("rag");
    expect(store.debugWidth).toBe(400);
    expect(store.expandedEntries).toEqual({});
    expect(store.expandedTexts).toEqual({});
    expect(store.schemaVersion).toBe(1);
  });

  it("init clamps a persisted out-of-range width back to default", () => {
    localStorage.setItem(
      "mikoshi.debug",
      JSON.stringify({
        debugWidth: 50_000, // way out of range, but schemaVersion is correct
        activeTab: "rag",
        expandedEntries: {},
        expandedTexts: {},
        schemaVersion: 1,
      }),
    );
    freshPinia();
    const store = useDebugStore();
    expect(store.debugWidth).toBe(400);
  });

  // Note: end-to-end persistence write-through isn't covered here. The plugin
  // hooks into Vue's reactivity which behaves differently under the node test
  // env vs the browser; the hydration path (above) is the load-bearing
  // direction for schemaVersion enforcement and is exercised directly.
});
