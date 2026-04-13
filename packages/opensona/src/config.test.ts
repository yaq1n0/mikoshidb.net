import { describe, it, expect } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deepMerge, loadConfig } from "./config.ts";

describe("deepMerge()", () => {
  it("replaces arrays rather than concatenating them", () => {
    const out = deepMerge({ xs: [1, 2, 3] }, { xs: [9] });
    expect(out.xs).toEqual([9]);
  });

  it("recurses into nested objects", () => {
    const out = deepMerge({ a: { b: 1, c: 2 } }, { a: { c: 30, d: 40 } });
    expect(out).toEqual({ a: { b: 1, c: 30, d: 40 } });
  });

  it("skips undefined values in source", () => {
    const out = deepMerge({ a: 1, b: 2 }, { a: undefined, c: 3 });
    expect(out).toEqual({ a: 1, b: 2, c: 3 });
  });

  it("prefers override when types mismatch (object in target, array in source)", () => {
    const out = deepMerge({ x: { a: 1 } }, { x: [1, 2] });
    expect(out.x).toEqual([1, 2]);
  });

  it("prefers override when target is array and source is object", () => {
    const out = deepMerge({ x: [1, 2] }, { x: { a: 1 } });
    expect(out.x).toEqual({ a: 1 });
  });

  it("primitive override wins", () => {
    const out = deepMerge({ a: 1 }, { a: 2 });
    expect(out.a).toBe(2);
  });

  it("null override wins for non-object keys and does not recurse", () => {
    const out = deepMerge({ a: { nested: true } }, { a: null });
    expect(out.a).toBeNull();
  });
});

describe("loadConfig()", () => {
  it("parses config.default.json when no override provided", async () => {
    const cfg = await loadConfig();
    expect(cfg.dumpPath).toBeTruthy();
    expect(cfg.graph.sectionMaxChars).toBeGreaterThan(0);
    expect(cfg.graph.leadMaxChars).toBeGreaterThan(0);
  });

  it("deep-merges overrides and re-validates", async () => {
    const dir = await mkdtemp(join(tmpdir(), "opensona-cfg-"));
    try {
      const overridePath = join(dir, "override.json");
      await writeFile(
        overridePath,
        JSON.stringify({ graph: { sectionMaxChars: 123 }, license: "Custom-1.0" }),
      );
      const cfg = await loadConfig(overridePath);
      expect(cfg.graph.sectionMaxChars).toBe(123);
      expect(cfg.license).toBe("Custom-1.0");
      expect(cfg.graph.leadMaxChars).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects unknown/extra keys via strict schema", async () => {
    const dir = await mkdtemp(join(tmpdir(), "opensona-cfg-"));
    try {
      const overridePath = join(dir, "override.json");
      await writeFile(overridePath, JSON.stringify({ bogusField: true }));
      await expect(loadConfig(overridePath)).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects malformed override JSON", async () => {
    const dir = await mkdtemp(join(tmpdir(), "opensona-cfg-"));
    try {
      const overridePath = join(dir, "override.json");
      await writeFile(overridePath, "{not: valid json");
      await expect(loadConfig(overridePath)).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
