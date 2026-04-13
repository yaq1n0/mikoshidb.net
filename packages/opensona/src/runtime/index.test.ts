import { describe, it, expect, vi, beforeEach } from "vitest";
import MiniSearch from "minisearch";
import type { Chunk, Manifest } from "../types.ts";
import type { LoadedBundle } from "./loader.ts";

vi.mock("./loader.ts", () => ({
  ensureLoaded: vi.fn(),
}));

vi.mock("./embedder.ts", () => ({
  embedQuery: vi.fn(),
}));

import { createRuntime } from "./index.ts";
import { ensureLoaded } from "./loader.ts";
import { embedQuery } from "./embedder.ts";

function makeLoadedBundle(): LoadedBundle {
  const dim = 2;
  const chunks: Chunk[] = [
    {
      id: "a#0",
      articleId: "a",
      title: "Alpha",
      header: "[Alpha]",
      text: "Alpha body",
      eventIds: [],
      latestEventOrder: -1,
      tags: [],
      categories: [],
    },
    {
      id: "b#0",
      articleId: "b",
      title: "Beta",
      header: "[Beta]",
      text: "Beta body",
      eventIds: [],
      latestEventOrder: -1,
      tags: [],
      categories: [],
    },
  ];
  const scales = new Float32Array([1, 1]);
  const quants = new Int8Array([100, 0, 0, 100]);

  const bm25 = new MiniSearch({
    fields: ["title", "header", "text"],
    storeFields: ["title", "header", "text"],
  });
  bm25.addAll(chunks.map((c) => ({ id: c.id, title: c.title, header: c.header, text: c.text })));

  const manifest: Manifest = {
    version: 1,
    buildDate: "2025-01-01",
    source: "t",
    license: "t",
    embedder: { library: "t", model: "test-model", dim, weightsHash: "x" },
    counts: { articles: 2, chunks: 2, events: 0 },
    timeline: { events: [] },
    files: {},
  };
  return { manifest, chunks, scales, quants, count: 2, dim, bm25 };
}

describe("createRuntime()", () => {
  beforeEach(() => {
    vi.mocked(ensureLoaded).mockReset();
    vi.mocked(embedQuery).mockReset();
  });

  it("manifest() returns null before load()", () => {
    const runtime = createRuntime();
    expect(runtime.manifest()).toBeNull();
  });

  it("query() throws before load()", async () => {
    const runtime = createRuntime();
    await expect(runtime.query("anything")).rejects.toThrow(/Runtime not loaded/);
  });

  it("inspect() throws before load()", async () => {
    const runtime = createRuntime();
    await expect(runtime.inspect("anything")).rejects.toThrow(/Runtime not loaded/);
  });

  it("manifest() returns the loaded manifest after load()", async () => {
    const bundle = makeLoadedBundle();
    vi.mocked(ensureLoaded).mockResolvedValue(bundle);
    const runtime = createRuntime();
    await runtime.load("https://x/");
    expect(runtime.manifest()).toBe(bundle.manifest);
  });

  it("query() returns only fused RetrievedChunk[] after load()", async () => {
    const bundle = makeLoadedBundle();
    vi.mocked(ensureLoaded).mockResolvedValue(bundle);
    vi.mocked(embedQuery).mockResolvedValue(new Float32Array([1, 0]));

    const runtime = createRuntime();
    await runtime.load("https://x/");

    const results = await runtime.query("Alpha");
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r).toHaveProperty("chunk");
      expect(r).toHaveProperty("score");
      expect(["dense", "bm25", "both"]).toContain(r.source);
    }
  });

  it("inspect() returns { dense, bm25, fused } after load()", async () => {
    const bundle = makeLoadedBundle();
    vi.mocked(ensureLoaded).mockResolvedValue(bundle);
    vi.mocked(embedQuery).mockResolvedValue(new Float32Array([1, 0]));

    const runtime = createRuntime();
    await runtime.load("https://x/");

    const { dense, bm25, fused } = await runtime.inspect("Alpha");
    expect(Array.isArray(dense)).toBe(true);
    expect(Array.isArray(bm25)).toBe(true);
    expect(Array.isArray(fused)).toBe(true);
  });

  it("two query() calls do not re-invoke ensureLoaded", async () => {
    const bundle = makeLoadedBundle();
    vi.mocked(ensureLoaded).mockResolvedValue(bundle);
    vi.mocked(embedQuery).mockResolvedValue(new Float32Array([1, 0]));

    const runtime = createRuntime();
    await runtime.load("https://x/");

    await runtime.query("Alpha");
    await runtime.query("Beta");

    expect(vi.mocked(ensureLoaded)).toHaveBeenCalledTimes(1);
  });

  it("passes onProgress callback through to ensureLoaded", async () => {
    const bundle = makeLoadedBundle();
    vi.mocked(ensureLoaded).mockResolvedValue(bundle);

    const runtime = createRuntime();
    const cb = vi.fn();
    await runtime.load("https://x/", cb);

    expect(vi.mocked(ensureLoaded)).toHaveBeenCalledWith("https://x/", cb);
  });

  it("query() re-invokes ensureLoaded when previous load failed (fallback branch)", async () => {
    const bundle = makeLoadedBundle();
    vi.mocked(ensureLoaded)
      .mockRejectedValueOnce(new Error("first load failed"))
      .mockResolvedValue(bundle);
    vi.mocked(embedQuery).mockResolvedValue(new Float32Array([1, 0]));

    const runtime = createRuntime();
    // First load sets bundlePath but throws before assigning loadedBundle.
    await expect(runtime.load("https://x/")).rejects.toThrow(/first load failed/);
    // Manifest is still null because loadedBundle never got set.
    expect(runtime.manifest()).toBeNull();
    // query() now takes the `?? (await ensureLoaded(bundlePath))` fallback.
    const results = await runtime.query("Alpha");
    expect(Array.isArray(results)).toBe(true);
    expect(vi.mocked(ensureLoaded)).toHaveBeenCalledTimes(2);
  });

  it("inspect() re-invokes ensureLoaded when previous load failed (fallback branch)", async () => {
    const bundle = makeLoadedBundle();
    vi.mocked(ensureLoaded)
      .mockRejectedValueOnce(new Error("first load failed"))
      .mockResolvedValue(bundle);
    vi.mocked(embedQuery).mockResolvedValue(new Float32Array([1, 0]));

    const runtime = createRuntime();
    await expect(runtime.load("https://x/")).rejects.toThrow(/first load failed/);
    const result = await runtime.inspect("Alpha");
    expect(result).toHaveProperty("fused");
  });

  it("query() passes manifest's embedder.model to embedQuery", async () => {
    const bundle = makeLoadedBundle();
    vi.mocked(ensureLoaded).mockResolvedValue(bundle);
    vi.mocked(embedQuery).mockResolvedValue(new Float32Array([1, 0]));

    const runtime = createRuntime();
    await runtime.load("https://x/");
    await runtime.query("Alpha");

    expect(vi.mocked(embedQuery)).toHaveBeenCalledWith("Alpha", "test-model");
  });
});
