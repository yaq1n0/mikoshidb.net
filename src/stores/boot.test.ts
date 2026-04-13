import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useBootStore } from "@/stores/boot";

describe("useBootStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("starts with ready=false", () => {
    const store = useBootStore();
    expect(store.ready).toBe(false);
  });

  it("hydrate() flips ready to true once resolved", async () => {
    const store = useBootStore();
    expect(store.ready).toBe(false);
    await store.hydrate();
    expect(store.ready).toBe(true);
  });

  it("hydrate() is idempotent — concurrent and post-resolve calls both resolve", async () => {
    const store = useBootStore();
    // Concurrent calls share the same in-flight hydration (no re-entrancy).
    const p1 = store.hydrate();
    const p2 = store.hydrate();
    await Promise.all([p1, p2]);
    expect(store.ready).toBe(true);
    // Post-resolve call still returns a resolved promise without re-running.
    await store.hydrate();
    expect(store.ready).toBe(true);
  });

  it("ready stays false until hydrate() resolves", async () => {
    const store = useBootStore();
    const p = store.hydrate();
    // Synchronously after calling hydrate, before awaiting — with an empty
    // task array this still goes through at least one microtask tick, so
    // ready must still be false here.
    expect(store.ready).toBe(false);
    await p;
    expect(store.ready).toBe(true);
  });
});
