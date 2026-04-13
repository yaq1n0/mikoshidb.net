import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, deepMerge } from "./config.ts";

async function withTempFile<T>(contents: string, fn: (path: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "opensona-cfg-"));
  const path = join(dir, "override.json");
  await writeFile(path, contents);
  try {
    return await fn(path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("deepMerge()", () => {
  it.each([
    ["scalars: source overwrites target", { a: 1 }, { a: 2 }, { a: 2 }],
    ["scalars: target key preserved when absent from source", { a: 1, b: 2 }, { a: 9 }, { a: 9, b: 2 }],
    ["scalars: new key from source is added", { a: 1 }, { b: 2 }, { a: 1, b: 2 }],
    ["nested object: deep merge, not replace", { x: { a: 1, b: 2 } }, { x: { b: 99 } }, { x: { a: 1, b: 99 } }],
    ["nested object: multiple levels deep", { x: { y: { a: 1, b: 2 } } }, { x: { y: { b: 9 } } }, { x: { y: { a: 1, b: 9 } } }],
    ["arrays: replaced wholesale, not concatenated", { arr: [1, 2, 3] }, { arr: [4, 5] }, { arr: [4, 5] }],
    ["arrays: target array preserved when source omits key", { arr: [1, 2] }, { x: 1 }, { arr: [1, 2], x: 1 }],
    ["null source value: overwrites target", { a: 1 }, { a: null }, { a: null }],
    ["null target value: source object not recursed into", { a: null }, { a: { b: 1 } }, { a: { b: 1 } }],
    ["undefined source value: target preserved", { a: 1 }, { a: undefined }, { a: 1 }],
    ["empty source: returns target clone", { a: 1 }, {}, { a: 1 }],
    ["empty target: returns source clone", {}, { a: 1 }, { a: 1 }],
  ])("%s", (_label, target, source, expected) => {
    expect(deepMerge(target, source)).toEqual(expected);
  });

  it("does not mutate the target object", () => {
    const target = { a: 1, b: { c: 2 } };
    deepMerge(target, { b: { c: 99 } });
    expect(target.b.c).toBe(2);
  });
});

describe("loadConfig()", () => {
  it("returns defaults when no override path is provided", async () => {
    const cfg = await loadConfig();
    expect(cfg.embedder.model).toBe("Xenova/bge-small-en-v1.5");
    expect(cfg.timelineArticleTitle).toBe("Timeline");
    expect(cfg.editionEras).toEqual([]);
    expect(cfg.categorySkip).toEqual({ prefixes: [], suffixes: [], exact: [] });
  });

  it("shallow override replaces scalar fields", async () => {
    const cfg = await withTempFile(
      JSON.stringify({ source: "https://x.wiki", license: "MIT" }),
      loadConfig,
    );
    expect(cfg.source).toBe("https://x.wiki");
    expect(cfg.license).toBe("MIT");
    // Untouched defaults still present
    expect(cfg.embedder.model).toBe("Xenova/bge-small-en-v1.5");
  });

  it("rejects unknown top-level keys in override", async () => {
    await expect(
      withTempFile(JSON.stringify({ editonEras: [] }), loadConfig),
    ).rejects.toThrow(/editonEras/);
  });

  it("rejects invalid values (e.g. non-URL source)", async () => {
    await expect(
      withTempFile(JSON.stringify({ source: "not-a-url" }), loadConfig),
    ).rejects.toThrow();
  });

  it("rejects editionEras where startYear > endYear", async () => {
    await expect(
      withTempFile(
        JSON.stringify({
          editionEras: [{ prefix: "P", label: "Era", startYear: 2020, endYear: 2010 }],
        }),
        loadConfig,
      ),
    ).rejects.toThrow();
  });

  it("deep-merges nested objects instead of replacing them", async () => {
    const cfg = await withTempFile(JSON.stringify({ embedder: { batchSize: 64 } }), loadConfig);
    // batchSize overridden
    expect(cfg.embedder.batchSize).toBe(64);
    // model + dim preserved from defaults
    expect(cfg.embedder.model).toBe("Xenova/bge-small-en-v1.5");
    expect(cfg.embedder.dim).toBe(384);
  });

  it("replaces arrays wholesale rather than concatenating", async () => {
    const cfg = await withTempFile(
      JSON.stringify({
        editionEras: [{ prefix: "P", label: "Era", startYear: 1, endYear: 2 }],
      }),
      loadConfig,
    );
    expect(cfg.editionEras).toHaveLength(1);
    expect(cfg.editionEras[0].prefix).toBe("P");
  });
});
