import { describe, it, expect } from "vitest";
import MiniSearch from "minisearch";
import { retrieve } from "./retrieve.ts";
import type { LoadedBundle } from "./loader.ts";
import type { Chunk, Manifest } from "../types.ts";

/**
 * Build a tiny LoadedBundle for testing.
 * 5 chunks, 4-dimensional vectors with predictable dot products.
 */
function makeTestBundle(): LoadedBundle {
  const dim = 4;

  const chunks: Chunk[] = [
    {
      id: "alpha#0",
      articleId: "alpha",
      title: "Alpha",
      header: "[Alpha]",
      text: "Alpha is a Night City gang leader.",
      eventIds: ["evt-2020"],
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
      eventIds: ["evt-2050"],
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
      eventIds: ["evt-2077"],
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
      eventIds: ["evt-2020"],
      latestEventOrder: 202001,
      tags: ["gang", "location"],
      categories: ["Gangs", "Locations"],
    },
  ];

  // Craft 4-dim vectors as int8 values:
  // chunk 0 (alpha):   [100, 0, 0, 0]   -> aligns with query [1,0,0,0]
  // chunk 1 (beta):    [0, 100, 0, 0]    -> aligns with query [0,1,0,0]
  // chunk 2 (gamma):   [50, 50, 0, 0]    -> moderate alignment with both
  // chunk 3 (delta):   [0, 0, 100, 0]    -> aligns with query [0,0,1,0]
  // chunk 4 (epsilon): [80, 0, 20, 0]    -> mostly aligns with [1,0,0,0]

  const count = chunks.length;
  const scales = new Float32Array(count);
  const quants = new Int8Array(count * dim);

  // All scales = 1.0 for simplicity
  scales.fill(1.0);

  const vectors: number[][] = [
    [100, 0, 0, 0],
    [0, 100, 0, 0],
    [50, 50, 0, 0],
    [0, 0, 100, 0],
    [80, 0, 20, 0],
  ];

  for (let i = 0; i < count; i++) {
    for (let j = 0; j < dim; j++) {
      quants[i * dim + j] = vectors[i][j];
    }
  }

  // Build real MiniSearch index
  const bm25 = new MiniSearch({
    fields: ["title", "header", "text"],
    storeFields: ["title", "header", "text"],
  });
  bm25.addAll(chunks.map((c) => ({ id: c.id, title: c.title, header: c.header, text: c.text })));

  const manifest: Manifest = {
    version: 1,
    buildDate: "2025-01-01",
    source: "test",
    license: "CC-BY-SA",
    embedder: {
      library: "test",
      model: "test/embedding-model",
      dim,
      weightsHash: "abc123",
    },
    counts: { articles: 5, chunks: 5, events: 3 },
    timeline: {
      events: [
        { id: "evt-2020", name: "2020 event", year: 2020, order: 202001 },
        { id: "evt-2050", name: "2050 event", year: 2050, order: 205001 },
        { id: "evt-2077", name: "2077 event", year: 2077, order: 207701 },
      ],
    },
    files: {},
  };

  return { manifest, chunks, scales, quants, count, dim, bm25 };
}

describe("retrieve()", () => {
  it("returns results matching the query vector (dense)", () => {
    const bundle = makeTestBundle();
    // Query vector that aligns with chunk 0 (alpha): [1, 0, 0, 0]
    const queryVec = new Float32Array([1, 0, 0, 0]);
    const result = retrieve(bundle, queryVec, "alpha", { topK: 5 });

    // Dense results should rank alpha (dot=100) highest, then epsilon (80), then gamma (50)
    expect(result.dense.length).toBeGreaterThan(0);
    expect(result.dense[0].chunk.id).toBe("alpha#0");
    expect(result.dense[0].score).toBe(100);

    // epsilon should rank second in dense (dot=80)
    expect(result.dense[1].chunk.id).toBe("epsilon#0");
    expect(result.dense[1].score).toBe(80);
  });

  it("timeline filtering excludes chunks with order > cutoff", () => {
    const bundle = makeTestBundle();
    const queryVec = new Float32Array([1, 1, 1, 1]); // hits everything

    // Cutoff at evt-2020 (order 202001) - should exclude beta (205001) and gamma (207701)
    const result = retrieve(bundle, queryVec, "something", {
      topK: 10,
      cutoffEventId: "evt-2020",
    });

    const denseIds = result.dense.map((r) => r.chunk.id);
    expect(denseIds).toContain("alpha#0"); // order 202001 <= cutoff
    expect(denseIds).toContain("epsilon#0"); // order 202001 <= cutoff
    expect(denseIds).toContain("delta#0"); // timeless (-1), always included
    expect(denseIds).not.toContain("beta#0"); // order 205001 > cutoff
    expect(denseIds).not.toContain("gamma#0"); // order 207701 > cutoff
  });

  it("timeless chunks (order -1) are always included", () => {
    const bundle = makeTestBundle();
    // Use a very early cutoff
    const queryVec = new Float32Array([0, 0, 1, 0]); // aligns with delta
    const result = retrieve(bundle, queryVec, "concept", {
      topK: 10,
      cutoffEventId: "evt-2020",
    });

    const denseIds = result.dense.map((r) => r.chunk.id);
    expect(denseIds).toContain("delta#0"); // timeless, always included
  });

  it("excludeTags filtering works", () => {
    const bundle = makeTestBundle();
    const queryVec = new Float32Array([1, 0, 0, 0]); // aligns with alpha and epsilon

    const result = retrieve(bundle, queryVec, "gang", {
      topK: 10,
      excludeTags: ["gang"],
    });

    const denseIds = result.dense.map((r) => r.chunk.id);
    // alpha and epsilon both have tag "gang", should be excluded
    expect(denseIds).not.toContain("alpha#0");
    expect(denseIds).not.toContain("epsilon#0");
    // beta, gamma, delta should remain
    expect(denseIds).toContain("beta#0");
    expect(denseIds).toContain("gamma#0");
    expect(denseIds).toContain("delta#0");
  });

  it("RRF fusion combines dense and BM25 results", () => {
    const bundle = makeTestBundle();
    // Query aligns with alpha densely, and "gang" should hit alpha/epsilon in BM25
    const queryVec = new Float32Array([1, 0, 0, 0]);
    const result = retrieve(bundle, queryVec, "gang", { topK: 5 });

    // Fused results should exist
    expect(result.fused.length).toBeGreaterThan(0);

    // Alpha should appear in fused (strong dense signal)
    const fusedIds = result.fused.map((r) => r.chunk.id);
    expect(fusedIds).toContain("alpha#0");

    // Check that sources are labeled
    for (const r of result.fused) {
      expect(["dense", "bm25", "both"]).toContain(r.source);
    }
  });

  it("__LAST_EVENT__ as cutoffEventId includes all chunks", () => {
    const bundle = makeTestBundle();
    const queryVec = new Float32Array([1, 1, 1, 1]);
    const result = retrieve(bundle, queryVec, "everything", {
      topK: 10,
      cutoffEventId: "__LAST_EVENT__",
    });

    // All 5 chunks should be in dense results (no filtering)
    expect(result.dense.length).toBe(5);
  });

  it("unknown cutoffEventId falls through to Infinity (no cutoff applied)", () => {
    const bundle = makeTestBundle();
    const queryVec = new Float32Array([1, 1, 1, 1]);
    const result = retrieve(bundle, queryVec, "everything", {
      topK: 10,
      cutoffEventId: "does-not-exist-xyz",
    });

    // cutoffOrder stays Infinity when event is not found — all 5 chunks pass
    expect(result.dense.length).toBe(5);
  });

  it("consumer filter function excludes chunks from fused results", () => {
    const bundle = makeTestBundle();
    const queryVec = new Float32Array([1, 0, 0, 0]); // aligns with alpha, epsilon
    const result = retrieve(bundle, queryVec, "gang", {
      topK: 10,
      filter: (chunk) => !chunk.tags.includes("gang"),
    });

    const fusedIds = result.fused.map((r) => r.chunk.id);
    expect(fusedIds).not.toContain("alpha#0"); // tag: gang
    expect(fusedIds).not.toContain("epsilon#0"); // tag: gang
  });

  it("excludeTags filters BM25 results", () => {
    const bundle = makeTestBundle();
    // Zero query vector so dense scoring is neutral; BM25 drives results
    const queryVec = new Float32Array(4); // all zeros
    const result = retrieve(bundle, queryVec, "gang", {
      topK: 10,
      excludeTags: ["gang"],
    });

    const bm25Ids = result.bm25.map((r) => r.chunk.id);
    // alpha and epsilon both have tag "gang" and mention "gang" in text
    expect(bm25Ids).not.toContain("alpha#0");
    expect(bm25Ids).not.toContain("epsilon#0");
  });

  it("timeline cutoff filters BM25 results", () => {
    const bundle = makeTestBundle();
    const queryVec = new Float32Array(4); // all zeros — BM25 drives results
    // cutoff at evt-2020 (order 202001): excludes beta (205001) and gamma (207701)
    const result = retrieve(bundle, queryVec, "Night City", {
      topK: 10,
      cutoffEventId: "evt-2020",
    });

    const bm25Ids = result.bm25.map((r) => r.chunk.id);
    expect(bm25Ids).not.toContain("beta#0"); // order 205001 > 202001
    expect(bm25Ids).not.toContain("gamma#0"); // order 207701 > 202001
  });

  it("RRF scores rank 0 picks = 1/60 for dense-only and bm25-only chunks", () => {
    // Build a bundle where:
    // - "alpha" is ONLY in dense (top rank 0 of dense, but zero BM25 score because
    //   the query text does not match any of alpha's fields).
    // - "beta" is ONLY in BM25 (top rank 0 of BM25, but its vector is orthogonal
    //   to the query vector, so dense score is 0 — however dense still contains it).
    //
    // To keep this test deterministic we craft a fresh mini bundle with only two
    // chunks where BM25 and dense rankings are perfectly disjoint.
    const dim = 2;
    const chunks: Chunk[] = [
      {
        id: "dense-only",
        articleId: "d",
        title: "Nothing special",
        header: "[D]",
        text: "xyzzy plugh",
        eventIds: [],
        latestEventOrder: -1,
        tags: [],
        categories: [],
      },
      {
        id: "bm25-only",
        articleId: "b",
        title: "unique-bm25-keyword",
        header: "[B]",
        text: "unique-bm25-keyword appears only here",
        eventIds: [],
        latestEventOrder: -1,
        tags: [],
        categories: [],
      },
    ];
    const scales = new Float32Array([1, 1]);
    const quants = new Int8Array([100, 0, 0, 0]); // dense-only aligns with [1,0]; bm25-only has zero vector
    const bm25 = new MiniSearch({
      fields: ["title", "header", "text"],
      storeFields: ["title", "header", "text"],
    });
    bm25.addAll(
      chunks.map((c) => ({ id: c.id, title: c.title, header: c.header, text: c.text })),
    );
    const manifest: Manifest = {
      version: 1,
      buildDate: "2025-01-01",
      source: "t",
      license: "t",
      embedder: { library: "t", model: "t", dim, weightsHash: "" },
      counts: { articles: 2, chunks: 2, events: 0 },
      timeline: { events: [] },
      files: {},
    };
    const bundle: LoadedBundle = {
      manifest,
      chunks,
      scales,
      quants,
      count: 2,
      dim,
      bm25,
    };

    const queryVec = new Float32Array([1, 0]);
    const result = retrieve(bundle, queryVec, "unique-bm25-keyword", { topK: 5 });

    // Both chunks make it to fused
    const byId = new Map(result.fused.map((r) => [r.chunk.id, r]));
    expect(byId.has("dense-only")).toBe(true);
    expect(byId.has("bm25-only")).toBe(true);

    // dense-only is rank 0 in dense, not in bm25 → 1/60
    const denseOnly = byId.get("dense-only")!;
    expect(denseOnly.source).toBe("dense");
    expect(denseOnly.score).toBeCloseTo(1 / 60, 10);

    // bm25-only is rank 0 in bm25. Its dense vector is all zeros so its dense
    // score is 0 — with two chunks it still gets dense rank 1 (1/61). Fused
    // score = 1/60 (bm25 rank 0) + 1/61 (dense rank 1).
    const bm25Only = byId.get("bm25-only")!;
    expect(bm25Only.source).toBe("both");
    expect(bm25Only.score).toBeCloseTo(1 / 60 + 1 / 61, 10);
  });

  it("chunks appearing in both dense and BM25 are tagged source: 'both'", () => {
    const bundle = makeTestBundle();
    // "Alpha" + vector aligned with alpha → alpha wins both rankings.
    const queryVec = new Float32Array([1, 0, 0, 0]);
    const result = retrieve(bundle, queryVec, "Alpha Night City gang leader", {
      topK: 10,
    });

    const alpha = result.fused.find((r) => r.chunk.id === "alpha#0");
    expect(alpha).toBeDefined();
    expect(alpha!.source).toBe("both");
  });

  it("handles empty BM25 results (no term matches) without crashing", () => {
    const bundle = makeTestBundle();
    const queryVec = new Float32Array([1, 0, 0, 0]);
    // A query text that has no tokens in any chunk's fields.
    const result = retrieve(bundle, queryVec, "zzzzqqqqxxxx_nomatch", { topK: 5 });

    expect(result.bm25).toEqual([]);
    expect(result.dense.length).toBeGreaterThan(0);
    expect(result.fused.length).toBeGreaterThan(0);
    // All fused sources should be "dense" since BM25 is empty.
    for (const r of result.fused) {
      expect(r.source).toBe("dense");
    }
  });

  it("BM25-only chunks not in the dense top-20 get their own fused entry", () => {
    // Build a bundle with 25 chunks: the first 20 align with the query vector
    // (making them the dense top-20), and chunk #24 is the only one whose text
    // contains the search term 'needle'. Its dense score is 0 so it falls out
    // of dense top-20 — but BM25 still surfaces it, exercising the else-branch
    // in retrieve.ts line 145.
    const dim = 2;
    const chunks: Chunk[] = [];
    const scales = new Float32Array(25);
    const quants = new Int8Array(25 * dim);
    scales.fill(1);
    for (let i = 0; i < 25; i++) {
      chunks.push({
        id: `c${i}`,
        articleId: `c${i}`,
        title: i === 24 ? "Needle" : `Chunk ${i}`,
        header: `[c${i}]`,
        text: i === 24 ? "needle unique text only here" : `filler text ${i}`,
        eventIds: [],
        latestEventOrder: -1,
        tags: [],
        categories: [],
      });
      // Give the first 20 chunks strong alignment with [1,0]; the rest zero.
      if (i < 20) {
        quants[i * dim] = 100;
      }
    }
    const bm25 = new MiniSearch({
      fields: ["title", "header", "text"],
      storeFields: ["title", "header", "text"],
    });
    bm25.addAll(
      chunks.map((c) => ({ id: c.id, title: c.title, header: c.header, text: c.text })),
    );
    const manifest: Manifest = {
      version: 1,
      buildDate: "2025-01-01",
      source: "t",
      license: "t",
      embedder: { library: "t", model: "t", dim, weightsHash: "" },
      counts: { articles: 25, chunks: 25, events: 0 },
      timeline: { events: [] },
      files: {},
    };
    const bundle: LoadedBundle = {
      manifest,
      chunks,
      scales,
      quants,
      count: 25,
      dim,
      bm25,
    };

    const queryVec = new Float32Array([1, 0]);
    const result = retrieve(bundle, queryVec, "needle", { topK: 30 });

    // Needle (c24) only scores via BM25; dense top-20 excludes it (dense score 0 → rank 20+ truncated).
    const needle = result.fused.find((r) => r.chunk.id === "c24");
    expect(needle).toBeDefined();
    expect(needle!.source).toBe("bm25");
  });

  it("topK=0 produces an empty fused list", () => {
    const bundle = makeTestBundle();
    const queryVec = new Float32Array([1, 0, 0, 0]);
    const result = retrieve(bundle, queryVec, "alpha gang", { topK: 0 });
    expect(result.fused).toEqual([]);
  });
});

