import { afterEach, describe, expect, it, vi } from "vitest";
import { acquireSessionLock } from "@/services/sessionLock";

type RequestCallback = (lock: unknown) => Promise<void> | void;
type LocksShim = {
  request: (name: string, opts: { ifAvailable: boolean }, cb: RequestCallback) => Promise<void>;
};

/** Node's global `navigator` is getter-only but configurable. */
const installLocks = (locks: LocksShim | null): void => {
  Object.defineProperty(globalThis, "navigator", {
    value: locks === null ? {} : { locks },
    configurable: true,
    writable: true,
  });
};

const clearNavigator = (): void => {
  Object.defineProperty(globalThis, "navigator", {
    value: undefined,
    configurable: true,
    writable: true,
  });
};

describe("acquireSessionLock", () => {
  afterEach(() => clearNavigator());

  it("fails open when navigator.locks is missing", async () => {
    installLocks(null);
    expect(await acquireSessionLock()).toBe(true);
  });

  it("resolves true when the lock is granted", async () => {
    installLocks({
      request: async (_name, _opts, cb) => {
        void cb({ name: "mikoshi-session" });
        return new Promise<void>(() => {
          /* hold forever */
        });
      },
    });
    expect(await acquireSessionLock()).toBe(true);
  });

  it("resolves false when lock is already held (callback receives null)", async () => {
    installLocks({
      request: async (_name, _opts, cb) => {
        void cb(null);
      },
    });
    expect(await acquireSessionLock()).toBe(false);
  });

  it("fails open when request throws synchronously", async () => {
    installLocks({
      request: (() => {
        throw new Error("no locks");
      }) as unknown as LocksShim["request"],
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await acquireSessionLock()).toBe(true);
    warn.mockRestore();
  });
});
