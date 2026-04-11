/**
 * Returns true if the browser exposes a usable WebGPU adapter.
 * Runs the adapter request lazily — only call once per session boot.
 */
export async function detectWebGPU(): Promise<boolean> {
  const nav = navigator as Navigator & {
    gpu?: { requestAdapter: () => Promise<unknown | null> };
  };
  if (!nav.gpu) return false;
  try {
    const adapter = await nav.gpu.requestAdapter();
    return adapter !== null && adapter !== undefined;
  } catch {
    return false;
  }
}
