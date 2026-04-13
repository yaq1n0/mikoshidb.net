import { describe, it, expect } from "vitest";
import { gunzipSync } from "node:zlib";
import MiniSearch from "minisearch";
import { packBundle } from "./pack.ts";
import type { Chunk, OpensonaConfig, Timeline } from "../types.ts";

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

function makeChunks(n: number): Chunk[] {
  const out: Chunk[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      id: `a-${i}#0`,
      articleId: `a-${i}`,
      title: `Article ${i}`,
      header: `[Article ${i}]`,
      text: `Body text for article ${i}. It mentions gangs and night city.`,
      eventIds: [],
      latestEventOrder: -1,
      tags: [],
      categories: [],
    });
  }
  return out;
}

function makeVectors(count: number, dim: number): Float32Array {
  const v = new Float32Array(count * dim);
  for (let i = 0; i < count; i++) {
    for (let j = 0; j < dim; j++) {
      // spread values so quantization exercises the scale path
      v[i * dim + j] = ((i + 1) * (j + 1)) / 100;
    }
  }
  return v;
}

const TIMELINE: Timeline = {
  events: [{ id: "e", name: "", year: 2077, order: 207701 }],
};

describe("packBundle()", () => {
  it("produces the four expected files and a well-formed manifest", async () => {
    const chunks = makeChunks(5);
    const dim = 4;
    const vectors = makeVectors(chunks.length, dim);

    const result = await packBundle(chunks, vectors, dim, TIMELINE, CONFIG);

    const paths = result.files.map((f) => f.path).sort();
    expect(paths).toEqual(["bm25.json.gz", "chunks.json.gz", "embeddings.i8.bin", "manifest.json"]);

    const m = result.manifest;
    expect(m.version).toBe(1);
    expect(m.source).toBe("example.wiki");
    expect(m.license).toBe("CC-BY-SA");
    expect(m.counts.articles).toBe(5);
    expect(m.counts.chunks).toBe(5);
    expect(m.counts.events).toBe(1);
    expect(m.embedder.dim).toBe(dim);
    expect(m.embedder.weightsHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("embeddings.i8.bin has [count][dim] header matching chunks", async () => {
    const chunks = makeChunks(3);
    const dim = 4;
    const vectors = makeVectors(chunks.length, dim);
    const { files } = await packBundle(chunks, vectors, dim, TIMELINE, CONFIG);

    const embeddings = files.find((f) => f.path === "embeddings.i8.bin")!;
    expect(embeddings.data.readUInt32LE(0)).toBe(3);
    expect(embeddings.data.readUInt32LE(4)).toBe(dim);
    // Header (8) + scales (3*4) + quants (3*dim)
    expect(embeddings.data.length).toBe(8 + 3 * 4 + 3 * dim);
  });

  it("chunks.json.gz round-trips to the original chunks", async () => {
    const chunks = makeChunks(2);
    const dim = 4;
    const vectors = makeVectors(chunks.length, dim);
    const { files } = await packBundle(chunks, vectors, dim, TIMELINE, CONFIG);

    const gz = files.find((f) => f.path === "chunks.json.gz")!;
    const restored = JSON.parse(gunzipSync(gz.data).toString("utf-8"));
    expect(restored).toEqual(chunks);
  });

  it("throws when total bundle size exceeds maxBundleBytes", async () => {
    const chunks = makeChunks(3);
    const dim = 4;
    const vectors = makeVectors(chunks.length, dim);
    const tinyConfig: OpensonaConfig = { ...CONFIG, maxBundleBytes: 10 };
    await expect(packBundle(chunks, vectors, dim, TIMELINE, tinyConfig)).rejects.toThrow(/exceeds/);
  });

  it("all-zero vector gives scale=1 (maxAbs guard at pack.ts:44)", async () => {
    const chunks = makeChunks(1);
    const dim = 4;
    const vectors = new Float32Array(dim); // all zeros
    const { files } = await packBundle(chunks, vectors, dim, TIMELINE, CONFIG);

    const embeddings = files.find((f) => f.path === "embeddings.i8.bin")!;
    // scale stored at offset 8 (after count:u32 + dim:u32) as Float32LE
    const scale = embeddings.data.readFloatLE(8);
    expect(scale).toBe(1);
  });

  it("clamps quantized components to the int8 range [-127, 127] at the max-magnitude boundary", async () => {
    // Vector where one element hits +maxAbs and another hits -maxAbs exactly,
    // so both components quantize to +127 / -127 (the clamp boundary values).
    const chunks = makeChunks(1);
    const dim = 4;
    const vectors = new Float32Array([1.0, -1.0, 0.5, 0.0]);
    const { files } = await packBundle(chunks, vectors, dim, TIMELINE, CONFIG);
    const embeddings = files.find((f) => f.path === "embeddings.i8.bin")!;
    // Header = 8 bytes, scales = 1*4 bytes, quants start at offset 12
    const quantOffset = 8 + 1 * 4;
    expect(embeddings.data.readInt8(quantOffset + 0)).toBe(127);
    expect(embeddings.data.readInt8(quantOffset + 1)).toBe(-127);
    // 0.5 / (1/127) = 63.5 -> rounds to 64 (or 63 via banker's rounding in JS round? Math.round rounds half up toward +Inf for positives)
    const mid = embeddings.data.readInt8(quantOffset + 2);
    expect(mid).toBeGreaterThanOrEqual(63);
    expect(mid).toBeLessThanOrEqual(64);
    expect(embeddings.data.readInt8(quantOffset + 3)).toBe(0);
    // All stored values must lie within the int8 clamp limits
    for (let j = 0; j < dim; j++) {
      const byte = embeddings.data.readInt8(quantOffset + j);
      expect(byte).toBeGreaterThanOrEqual(-127);
      expect(byte).toBeLessThanOrEqual(127);
    }
  });

  it("bm25.json.gz round-trips through gunzip + MiniSearch.loadJSON and finds known terms", async () => {
    const chunks = makeChunks(5);
    const dim = 4;
    const vectors = makeVectors(chunks.length, dim);
    const { files } = await packBundle(chunks, vectors, dim, TIMELINE, CONFIG);

    const bm25File = files.find((f) => f.path === "bm25.json.gz")!;
    const json = gunzipSync(bm25File.data).toString("utf-8");
    const mini = MiniSearch.loadJSON(json, {
      fields: CONFIG.bm25.fields,
      storeFields: CONFIG.bm25.fields,
    });

    // "gangs" and "night" appear in every chunk's text; "article" appears in every title.
    const results = mini.search("gangs");
    expect(results.length).toBeGreaterThan(0);
    const ids = results.map((r) => r.id);
    // Every generated chunk id should be represented
    for (let i = 0; i < chunks.length; i++) {
      expect(ids).toContain(`a-${i}#0`);
    }
  });

  it("identical inputs produce identical manifest.embedder.weightsHash (deterministic)", async () => {
    const chunksA = makeChunks(3);
    const chunksB = makeChunks(3);
    const dim = 4;
    const vectorsA = makeVectors(chunksA.length, dim);
    const vectorsB = makeVectors(chunksB.length, dim);

    const resultA = await packBundle(chunksA, vectorsA, dim, TIMELINE, CONFIG);
    const resultB = await packBundle(chunksB, vectorsB, dim, TIMELINE, CONFIG);

    // weightsHash is independent of buildDate — it's a SHA256 of the embeddings bin
    expect(resultA.manifest.embedder.weightsHash).toBe(resultB.manifest.embedder.weightsHash);
    expect(resultA.manifest.files.chunks.sha256).toBe(resultB.manifest.files.chunks.sha256);
    expect(resultA.manifest.files.bm25.sha256).toBe(resultB.manifest.files.bm25.sha256);
  });
});
