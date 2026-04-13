// packages/opensona/src/build/verify.ts
// Verification engine: run canned queries against a bundle and check assertions

import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";
import { pipeline } from "@huggingface/transformers";
import MiniSearch from "minisearch";
import type { Chunk, Manifest } from "../types.ts";
import { unitNormalize } from "./vector-math.ts";

export interface VerifyCase {
  name: string;
  query: string;
  cutoffEventId: string;
  mustContain?: string[];
  mustNotContain?: string[];
}

export interface VerifyResult {
  name: string;
  passed: boolean;
  query: string;
  chunks: { id: string; header: string; score: number; textSnippet: string }[];
  failures: string[];
}

/**
 * Parse the int8 embedding file.
 * Format: [count:u32][dim:u32][scales:Float32(count)][quants:Int8(count*dim)]
 */
export function parseEmbeddings(buf: Buffer): {
  count: number;
  dim: number;
  scales: Float32Array;
  quants: Int8Array;
} {
  const count = buf.readUInt32LE(0);
  const dim = buf.readUInt32LE(4);
  const headerSize = 8;
  const scalesSize = count * 4;

  const scalesBuf = buf.subarray(headerSize, headerSize + scalesSize);
  const scales = new Float32Array(scalesBuf.buffer, scalesBuf.byteOffset, count);

  const quantsBuf = buf.subarray(headerSize + scalesSize);
  const quants = new Int8Array(quantsBuf.buffer, quantsBuf.byteOffset, count * dim);

  return { count, dim, scales, quants };
}

/**
 * Resolve a cutoffEventId to the corresponding event order.
 * Returns Infinity for __LAST_EVENT__ (no cutoff).
 */
export function resolveCutoffOrder(manifest: Manifest, cutoffEventId: string): number {
  if (cutoffEventId === "__LAST_EVENT__") {
    return Infinity;
  }

  const event = manifest.timeline.events.find((e) => e.id === cutoffEventId);
  if (!event) {
    throw new Error(`cutoffEventId not found in timeline: ${cutoffEventId}`);
  }
  return event.order;
}

/**
 * Dense retrieval: brute-force dot product with timeline filtering.
 * Returns top-k indices sorted by score descending.
 */
export function denseRetrieve(
  queryVec: Float32Array,
  scales: Float32Array,
  quants: Int8Array,
  dim: number,
  count: number,
  chunks: Chunk[],
  cutoffOrder: number,
  topK: number,
): { index: number; score: number }[] {
  const results: { index: number; score: number }[] = [];

  for (let k = 0; k < count; k++) {
    // Timeline filter: skip chunks whose latestEventOrder exceeds cutoff
    // latestEventOrder === -1 means timeless, always allowed
    const chunkOrder = chunks[k].latestEventOrder;
    if (chunkOrder !== -1 && chunkOrder > cutoffOrder) {
      continue;
    }

    // score = scales[k] * sum(queryVec[j] * quants[k*dim + j])
    const offset = k * dim;
    let dot = 0;
    for (let j = 0; j < dim; j++) {
      dot += queryVec[j] * quants[offset + j];
    }
    const score = scales[k] * dot;

    results.push({ index: k, score });
  }

  // Sort descending by score and take top-k
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, topK);
}

/**
 * BM25 retrieval with timeline filtering.
 */
export function bm25Retrieve(
  miniSearch: MiniSearch,
  query: string,
  chunks: Chunk[],
  chunkIdToIndex: Map<string, number>,
  cutoffOrder: number,
  topK: number,
): { index: number; score: number }[] {
  const searchResults = miniSearch.search(query, {
    fuzzy: 0.2,
    prefix: true,
  });

  const filtered: { index: number; score: number }[] = [];
  for (const result of searchResults) {
    const idx = chunkIdToIndex.get(String(result.id));
    if (idx === undefined) continue;

    const chunkOrder = chunks[idx].latestEventOrder;
    if (chunkOrder !== -1 && chunkOrder > cutoffOrder) {
      continue;
    }

    filtered.push({ index: idx, score: result.score });
  }

  return filtered.slice(0, topK);
}

/**
 * RRF fusion: rrf(rank) = 1/(60+rank), sum scores, take top-k.
 */
export function rrfFuse(
  denseResults: { index: number; score: number }[],
  bm25Results: { index: number; score: number }[],
  topK: number,
): { index: number; score: number; source: "dense" | "bm25" | "both" }[] {
  const scores = new Map<number, { score: number; hasDense: boolean; hasBm25: boolean }>();

  for (let rank = 0; rank < denseResults.length; rank++) {
    const { index } = denseResults[rank];
    const rrfScore = 1 / (60 + rank);
    const entry = scores.get(index) ?? {
      score: 0,
      hasDense: false,
      hasBm25: false,
    };
    entry.score += rrfScore;
    entry.hasDense = true;
    scores.set(index, entry);
  }

  for (let rank = 0; rank < bm25Results.length; rank++) {
    const { index } = bm25Results[rank];
    const rrfScore = 1 / (60 + rank);
    const entry = scores.get(index) ?? {
      score: 0,
      hasDense: false,
      hasBm25: false,
    };
    entry.score += rrfScore;
    entry.hasBm25 = true;
    scores.set(index, entry);
  }

  const fused: {
    index: number;
    score: number;
    source: "dense" | "bm25" | "both";
  }[] = [];
  for (const [index, entry] of scores) {
    const source = entry.hasDense && entry.hasBm25 ? "both" : entry.hasDense ? "dense" : "bm25";
    fused.push({ index, score: entry.score, source });
  }

  fused.sort((a, b) => b.score - a.score);
  return fused.slice(0, topK);
}

/**
 * Run verification cases against a built bundle.
 */
export async function verifyBundle(
  bundleDir: string,
  cases: VerifyCase[],
  onProgress?: (done: number, total: number) => void,
): Promise<VerifyResult[]> {
  // 1. Read manifest
  const manifestRaw = await readFile(join(bundleDir, "manifest.json"), "utf-8");
  const manifest: Manifest = JSON.parse(manifestRaw);

  // 2. Read + decompress chunks
  const chunksGz = await readFile(join(bundleDir, "chunks.json.gz"));
  const chunksJson = gunzipSync(chunksGz).toString("utf-8");
  const chunks: Chunk[] = JSON.parse(chunksJson);

  // Build chunk ID to index map
  const chunkIdToIndex = new Map<string, number>();
  for (let i = 0; i < chunks.length; i++) {
    chunkIdToIndex.set(chunks[i].id, i);
  }

  // 3. Read embeddings
  const embeddingsBuf = await readFile(join(bundleDir, "embeddings.i8.bin"));
  const { count, dim, scales, quants } = parseEmbeddings(embeddingsBuf);

  if (count !== chunks.length) {
    throw new Error(`Embedding count (${count}) does not match chunk count (${chunks.length})`);
  }

  // 4. Read + load BM25 index
  const bm25Gz = await readFile(join(bundleDir, "bm25.json.gz"));
  const bm25Json = gunzipSync(bm25Gz).toString("utf-8");
  const miniSearch = MiniSearch.loadJSON(bm25Json, {
    fields: ["title", "header", "text"],
    storeFields: ["title", "header", "text"],
  });

  // 5. Load embedding model (read model ID from manifest, not hardcoded)
  const extractor = await pipeline("feature-extraction", manifest.embedder.model, {
    dtype: "fp32",
  });

  // 6. Run each case
  const results: VerifyResult[] = [];

  for (let i = 0; i < cases.length; i++) {
    const testCase = cases[i];

    // a. Embed the query
    const output = await extractor(testCase.query, {
      pooling: "mean",
      normalize: false,
    });
    const queryVec = new Float32Array(output.data as Float32Array);
    unitNormalize(queryVec);

    // b. Resolve cutoff
    const cutoffOrder = resolveCutoffOrder(manifest, testCase.cutoffEventId);

    // c. Dense retrieval (top 20)
    const denseResults = denseRetrieve(
      queryVec,
      scales,
      quants,
      dim,
      count,
      chunks,
      cutoffOrder,
      20,
    );

    // d. BM25 retrieval (top 20)
    const bm25Results = bm25Retrieve(
      miniSearch,
      testCase.query,
      chunks,
      chunkIdToIndex,
      cutoffOrder,
      20,
    );

    // e. RRF fusion (top 3)
    const fused = rrfFuse(denseResults, bm25Results, 3);

    // f. Build result chunks
    const resultChunks = fused.map((r) => {
      const chunk = chunks[r.index];
      return {
        id: chunk.id,
        header: chunk.header,
        score: r.score,
        textSnippet: chunk.text.slice(0, 120),
      };
    });

    // g. Check assertions
    const failures: string[] = [];

    if (testCase.mustContain) {
      for (const needle of testCase.mustContain) {
        const lower = needle.toLowerCase();
        const found = fused.some((r) => chunks[r.index].text.toLowerCase().includes(lower));
        if (!found) {
          failures.push(`mustContain "${needle}" not found in any top-3 chunk`);
        }
      }
    }

    if (testCase.mustNotContain) {
      for (const needle of testCase.mustNotContain) {
        const lower = needle.toLowerCase();
        const found = fused.some((r) => chunks[r.index].text.toLowerCase().includes(lower));
        if (found) {
          failures.push(`mustNotContain "${needle}" was found in a top-3 chunk`);
        }
      }
    }

    results.push({
      name: testCase.name,
      passed: failures.length === 0,
      query: testCase.query,
      chunks: resultChunks,
      failures,
    });

    onProgress?.(i + 1, cases.length);
  }

  return results;
}
