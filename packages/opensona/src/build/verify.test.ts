import { describe, it, expect } from "vitest";
import MiniSearch from "minisearch";
import { packBundle } from "./pack.ts";
import {
  parseEmbeddings,
  resolveCutoffOrder,
  denseRetrieve,
  bm25Retrieve,
  rrfFuse,
} from "./verify.ts";
import type { Chunk, Manifest, OpensonaConfig, Timeline } from "../types.ts";

const CONFIG: OpensonaConfig = {
  dumpPath: "",
  generatedDir: "",
  source: "example.wiki",
  license: "CC-BY-SA",
  embedder: { model: "test/m", dim: 4, batchSize: 8 },
  chunking: { targetTokens: 100, maxTokens: 200, overlapTokens: 20 },
  maxBundleBytes: 10 * 1024 * 1024,
  bm25: { fields: ["title", "header", "text"], boosts: { title: 3, header: 2, text: 1 } },
  timelineArticleTitle: "Timeline",
  timelineValidation: { minYearHeadings: 1, minEvents: 1 },
  editionEras: [],
  categorySkip: { prefixes: [], suffixes: [], exact: [] },
};

const TIMELINE: Timeline = {
  events: [
    { id: "evt-early", name: "Early", year: 2020, order: 202001 },
    { id: "evt-mid", name: "Mid", year: 2050, order: 205001 },
    { id: "evt-late", name: "Late", year: 2077, order: 207701 },
  ],
};

function makeChunks(): Chunk[] {
  return [
    {
      id: "alpha#0",
      articleId: "alpha",
      title: "Alpha",
      header: "[Alpha]",
      text: "Alpha is a Night City gang leader.",
      eventIds: ["evt-early"],
      latestEventOrder: 202001,
      tags: ["gang"],
      categories: ["Gangs"],
    },
    {
      id: "beta#0",
      articleId: "beta",
      title: "Beta",
      header: "[Beta]",
      text: "Beta is a corpo district in Night City.",
      eventIds: ["evt-mid"],
      latestEventOrder: 205001,
      tags: ["location"],
      categories: ["Locations"],
    },
    {
      id: "gamma#0",
      articleId: "gamma",
      title: "Gamma",
      header: "[Gamma]",
      text: "Gamma is a weapon manufacturer.",
      eventIds: ["evt-late"],
      latestEventOrder: 207701,
      tags: ["corporation"],
      categories: ["Corporations"],
    },
    {
      id: "delta#0",
      articleId: "delta",
      title: "Delta",
      header: "[Delta]",
      text: "Delta is a timeless concept in cyberpunk lore.",
      eventIds: [],
      latestEventOrder: -1,
      tags: ["meta"],
      categories: ["Meta"],
    },
    {
      id: "epsilon#0",
      articleId: "epsilon",
      title: "Epsilon",
      header: "[Epsilon]",
      text: "Epsilon is a gang hideout near the combat zone.",
      eventIds: ["evt-early"],
      latestEventOrder: 202001,
      tags: ["gang", "location"],
      categories: ["Gangs", "Locations"],
    },
  ];
}

function makeVectors(count: number, dim: number): Float32Array {
  // Craft distinctive vectors per chunk to exercise the quantization path.
  const patterns: number[][] = [
    [1.0, 0, 0, 0],
    [0, 1.0, 0, 0],
    [0.5, 0.5, 0, 0],
    [0, 0, 1.0, 0],
    [0.8, 0, 0.2, 0],
  ];
  const v = new Float32Array(count * dim);
  for (let i = 0; i < count; i++) {
    for (let j = 0; j < dim; j++) {
      v[i * dim + j] = patterns[i % patterns.length][j] ?? 0;
    }
  }
  return v;
}

function makeMiniSearch(chunks: Chunk[]): MiniSearch {
  const ms = new MiniSearch({
    fields: ["title", "header", "text"],
    storeFields: ["title", "header", "text"],
  });
  ms.addAll(
    chunks.map((c) => ({ id: c.id, title: c.title, header: c.header, text: c.text })),
  );
  return ms;
}

function makeManifest(): Manifest {
  return {
    version: 1,
    buildDate: "2025-01-01",
    source: "test",
    license: "CC-BY-SA",
    embedder: {
      library: "test",
      model: "test/m",
      dim: 4,
      weightsHash: "abc123",
    },
    counts: { articles: 5, chunks: 5, events: 3 },
    timeline: TIMELINE,
    files: {},
  };
}

describe("parseEmbeddings()", () => {
  it("round-trips quantizeInt8 output from packBundle", async () => {
    const chunks = makeChunks();
    const dim = 4;
    const vectors = makeVectors(chunks.length, dim);

    const { files } = await packBundle(chunks, vectors, dim, TIMELINE, CONFIG);
    const embeddings = files.find((f) => f.path === "embeddings.i8.bin")!;

    const parsed = parseEmbeddings(embeddings.data);

    expect(parsed.count).toBe(chunks.length);
    expect(parsed.dim).toBe(dim);
    expect(parsed.scales).toBeInstanceOf(Float32Array);
    expect(parsed.scales.length).toBe(chunks.length);
    expect(parsed.quants).toBeInstanceOf(Int8Array);
    expect(parsed.quants.length).toBe(chunks.length * dim);

    // Dequantize each vector and confirm it approximates the original input.
    for (let i = 0; i < chunks.length; i++) {
      const scale = parsed.scales[i];
      expect(scale).toBeGreaterThan(0);
      for (let j = 0; j < dim; j++) {
        const original = vectors[i * dim + j];
        const dequant = parsed.quants[i * dim + j] * scale;
        // Max error ≈ scale (half a quant step, rounded).
        expect(Math.abs(dequant - original)).toBeLessThanOrEqual(scale + 1e-6);
      }
    }
  });
});

describe("resolveCutoffOrder()", () => {
  const manifest = makeManifest();

  it("returns Infinity for __LAST_EVENT__", () => {
    expect(resolveCutoffOrder(manifest, "__LAST_EVENT__")).toBe(Infinity);
  });

  it("returns event.order for a known event id", () => {
    expect(resolveCutoffOrder(manifest, "evt-early")).toBe(202001);
    expect(resolveCutoffOrder(manifest, "evt-mid")).toBe(205001);
    expect(resolveCutoffOrder(manifest, "evt-late")).toBe(207701);
  });

  it("throws when cutoffEventId is not present in the timeline", () => {
    expect(() => resolveCutoffOrder(manifest, "does-not-exist")).toThrow(
      /cutoffEventId not found/,
    );
  });
});

describe("denseRetrieve()", () => {
  const dim = 4;

  function makeDenseFixture() {
    const chunks = makeChunks();
    const count = chunks.length;
    const scales = new Float32Array(count);
    scales.fill(1.0);
    const quants = new Int8Array(count * dim);
    const vectors: number[][] = [
      [100, 0, 0, 0], // alpha
      [0, 100, 0, 0], // beta
      [50, 50, 0, 0], // gamma
      [0, 0, 100, 0], // delta (timeless)
      [80, 0, 20, 0], // epsilon
    ];
    for (let i = 0; i < count; i++) {
      for (let j = 0; j < dim; j++) {
        quants[i * dim + j] = vectors[i][j];
      }
    }
    return { chunks, count, scales, quants };
  }

  it("respects top-k: requesting 2 yields exactly 2 results", () => {
    const { chunks, count, scales, quants } = makeDenseFixture();
    const queryVec = new Float32Array([1, 1, 1, 1]); // matches everything
    const results = denseRetrieve(queryVec, scales, quants, dim, count, chunks, Infinity, 2);
    expect(results).toHaveLength(2);
  });

  it("excludes chunks whose latestEventOrder exceeds the cutoff", () => {
    const { chunks, count, scales, quants } = makeDenseFixture();
    const queryVec = new Float32Array([1, 1, 1, 1]);
    // Cutoff at evt-early (202001) should drop beta (205001) and gamma (207701).
    const results = denseRetrieve(queryVec, scales, quants, dim, count, chunks, 202001, 10);
    const ids = results.map((r) => chunks[r.index].id);
    expect(ids).toContain("alpha#0");
    expect(ids).toContain("epsilon#0");
    expect(ids).toContain("delta#0");
    expect(ids).not.toContain("beta#0");
    expect(ids).not.toContain("gamma#0");
  });

  it("includes timeless chunks (latestEventOrder === -1) regardless of cutoff", () => {
    const { chunks, count, scales, quants } = makeDenseFixture();
    // Query aligned with delta (timeless)
    const queryVec = new Float32Array([0, 0, 1, 0]);
    // Very early cutoff: -10 — excludes every dated chunk.
    const results = denseRetrieve(queryVec, scales, quants, dim, count, chunks, -10, 10);
    const ids = results.map((r) => chunks[r.index].id);
    expect(ids).toContain("delta#0");
    expect(ids).not.toContain("alpha#0");
    expect(ids).not.toContain("beta#0");
    expect(ids).not.toContain("gamma#0");
    expect(ids).not.toContain("epsilon#0");
  });

  it("returns results sorted in descending score order", () => {
    const { chunks, count, scales, quants } = makeDenseFixture();
    const queryVec = new Float32Array([1, 0, 0, 0]); // alpha(100) > epsilon(80) > gamma(50)
    const results = denseRetrieve(queryVec, scales, quants, dim, count, chunks, Infinity, 5);
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
    expect(chunks[results[0].index].id).toBe("alpha#0");
    expect(chunks[results[1].index].id).toBe("epsilon#0");
    expect(chunks[results[2].index].id).toBe("gamma#0");
  });
});

describe("bm25Retrieve()", () => {
  it("applies the timeline cutoff, excluding chunks with order > cutoff", () => {
    const chunks = makeChunks();
    const ms = makeMiniSearch(chunks);
    const chunkIdToIndex = new Map<string, number>(chunks.map((c, i) => [c.id, i]));

    // "Night City" is in alpha (202001) and beta (205001).
    // Cutoff at evt-early (202001) should drop beta.
    const results = bm25Retrieve(ms, "Night City", chunks, chunkIdToIndex, 202001, 10);
    const ids = results.map((r) => chunks[r.index].id);
    expect(ids).toContain("alpha#0");
    expect(ids).not.toContain("beta#0");
  });

  it("respects top-k", () => {
    const chunks = makeChunks();
    const ms = makeMiniSearch(chunks);
    const chunkIdToIndex = new Map<string, number>(chunks.map((c, i) => [c.id, i]));

    // "gang" hits alpha and epsilon; cap at 1.
    const results = bm25Retrieve(ms, "gang", chunks, chunkIdToIndex, Infinity, 1);
    expect(results).toHaveLength(1);
  });

  it("skips search hits whose ID is missing from chunkIdToIndex", () => {
    const chunks = makeChunks();
    // Build a MiniSearch with an *extra* doc whose id is not in the map.
    const extraDoc = {
      id: "phantom#0",
      title: "Phantom",
      header: "[Phantom]",
      text: "Phantom gang ghost document.",
    };
    const ms = new MiniSearch({
      fields: ["title", "header", "text"],
      storeFields: ["title", "header", "text"],
    });
    ms.addAll([
      ...chunks.map((c) => ({ id: c.id, title: c.title, header: c.header, text: c.text })),
      extraDoc,
    ]);

    // Build map WITHOUT the phantom id.
    const chunkIdToIndex = new Map<string, number>(chunks.map((c, i) => [c.id, i]));

    const results = bm25Retrieve(ms, "gang phantom", chunks, chunkIdToIndex, Infinity, 10);
    const returnedIds = results.map((r) => chunks[r.index].id);
    expect(returnedIds).not.toContain("phantom#0");
    // Every returned index should point to a real chunk.
    for (const r of results) {
      expect(r.index).toBeGreaterThanOrEqual(0);
      expect(r.index).toBeLessThan(chunks.length);
    }
  });
});

describe("rrfFuse()", () => {
  it("scores a chunk at rank 0 in both dense and bm25 with 2/60", () => {
    const dense = [{ index: 0, score: 10 }];
    const bm25 = [{ index: 0, score: 5 }];
    const fused = rrfFuse(dense, bm25, 5);
    expect(fused).toHaveLength(1);
    expect(fused[0].index).toBe(0);
    expect(fused[0].source).toBe("both");
    expect(fused[0].score).toBeCloseTo(2 / 60, 10);
  });

  it("marks source 'both' when a chunk appears in both dense and bm25", () => {
    const dense = [
      { index: 0, score: 10 },
      { index: 1, score: 8 },
    ];
    const bm25 = [{ index: 1, score: 5 }];
    const fused = rrfFuse(dense, bm25, 5);
    const entry = fused.find((f) => f.index === 1)!;
    expect(entry.source).toBe("both");
  });

  it("marks source 'dense' / 'bm25' for single-source entries", () => {
    const dense = [{ index: 0, score: 10 }];
    const bm25 = [{ index: 1, score: 5 }];
    const fused = rrfFuse(dense, bm25, 5);

    const denseOnly = fused.find((f) => f.index === 0)!;
    expect(denseOnly.source).toBe("dense");

    const bm25Only = fused.find((f) => f.index === 1)!;
    expect(bm25Only.source).toBe("bm25");
  });

  it("respects topK", () => {
    const dense = [
      { index: 0, score: 10 },
      { index: 1, score: 9 },
      { index: 2, score: 8 },
    ];
    const bm25 = [
      { index: 3, score: 6 },
      { index: 4, score: 5 },
    ];
    const fused = rrfFuse(dense, bm25, 2);
    expect(fused).toHaveLength(2);
    // And the output is sorted descending.
    for (let i = 1; i < fused.length; i++) {
      expect(fused[i - 1].score).toBeGreaterThanOrEqual(fused[i].score);
    }
  });
});
