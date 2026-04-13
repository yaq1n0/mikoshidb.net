/**
 * Web Locks-based single-tab guard.
 *
 * We use `navigator.locks.request` in `ifAvailable` mode so a second tab can
 * immediately discover the lock is held without waiting. The winning tab holds
 * the lock for its entire lifetime — the callback never resolves; the browser
 * releases the lock automatically when the tab unloads.
 *
 * Per PLAN §2: no handoff state machine. Second tab → lockout with copy asking
 * the user to close the other tab and refresh.
 */

const LOCK_NAME = "mikoshi-session";

/**
 * Try to acquire the singleton session lock.
 *
 * Returns:
 *   - `true` if this tab now holds the lock (or the Web Locks API is
 *     unavailable — we fail open on old browsers rather than locking the user
 *     out of their only tab).
 *   - `false` if another tab already holds it.
 *
 * The lock (when acquired) is held forever — the inner callback never resolves.
 */
export async function acquireSessionLock(): Promise<boolean> {
  // Old browsers: fail open. The unified lockout still covers WebGPU-missing,
  // which is the load-bearing compat gate.
  if (typeof navigator === "undefined" || !navigator.locks) {
    return true;
  }

  return new Promise<boolean>((resolve) => {
    try {
      void navigator.locks.request(LOCK_NAME, { ifAvailable: true }, async (lock) => {
        if (lock === null) {
          // Another tab already owns it.
          resolve(false);
          return;
        }
        // Won the lock — signal success to the caller, then hold forever.
        // The browser releases the lock automatically on tab unload.
        resolve(true);
        await new Promise<void>(() => {
          /* hold forever */
        });
      });
    } catch (err) {
      console.warn("[sessionLock] request threw; failing open", err);
      resolve(true);
    }
  });
}
