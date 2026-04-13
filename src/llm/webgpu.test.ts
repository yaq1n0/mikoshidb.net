import { afterEach, describe, expect, it } from "vitest";
import { detectWebGPU } from "@/llm/webgpu";

type GpuShim = { requestAdapter: () => Promise<unknown | null> };

/** Node exposes `navigator` as a getter-only global; redefine it per-test. */
const installNavigator = (value: { gpu?: GpuShim }): void => {
  Object.defineProperty(globalThis, "navigator", {
    value,
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

describe("detectWebGPU", () => {
  afterEach(() => clearNavigator());

  it("returns false when navigator.gpu is absent", async () => {
    installNavigator({});
    expect(await detectWebGPU()).toBe(false);
  });

  it("returns true when requestAdapter resolves to an adapter", async () => {
    installNavigator({ gpu: { requestAdapter: async () => ({ name: "x" }) } });
    expect(await detectWebGPU()).toBe(true);
  });

  it("returns false when requestAdapter resolves to null", async () => {
    installNavigator({ gpu: { requestAdapter: async () => null } });
    expect(await detectWebGPU()).toBe(false);
  });

  it("returns false when requestAdapter throws", async () => {
    installNavigator({
      gpu: {
        requestAdapter: async () => {
          throw new Error("boom");
        },
      },
    });
    expect(await detectWebGPU()).toBe(false);
  });
});
