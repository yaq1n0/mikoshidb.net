// packages/opensona/src/build/pack.ts
// Bundle packing: quantize embeddings, build BM25 index, produce output files

import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import MiniSearch from "minisearch";
import type { Chunk, Manifest, OpensonaConfig, Timeline } from "../types.ts";

export interface PackResult {
  manifest: Manifest;
  files: { path: string; data: Buffer }[];
}

/**
 * Quantize Float32 vectors to Int8 with per-vector scaling.
 * Format: [count:u32][dim:u32][scales:Float32(count)][quants:Int8(count*dim)]
 */
function quantizeInt8(vectors: Float32Array, count: number, dim: number): Buffer {
  // Header: 4 bytes count + 4 bytes dim
  // Scales: 4 bytes * count
  // Quants: 1 byte * count * dim
  const headerSize = 8;
  const scalesSize = count * 4;
  const quantsSize = count * dim;
  const totalSize = headerSize + scalesSize + quantsSize;

  const buffer = Buffer.alloc(totalSize);

  // Write header
  buffer.writeUInt32LE(count, 0);
  buffer.writeUInt32LE(dim, 4);

  // Compute per-vector scales and quantize
  for (let i = 0; i < count; i++) {
    const vecOffset = i * dim;

    // Find max absolute value
    let maxAbs = 0;
    for (let j = 0; j < dim; j++) {
      const absVal = Math.abs(vectors[vecOffset + j]);
      if (absVal > maxAbs) maxAbs = absVal;
    }

    const scale = maxAbs > 0 ? maxAbs / 127 : 1;

    // Write scale
    buffer.writeFloatLE(scale, headerSize + i * 4);

    // Write quantized values
    const quantOffset = headerSize + scalesSize + i * dim;
    for (let j = 0; j < dim; j++) {
      const quantized = Math.round(vectors[vecOffset + j] / scale);
      // Clamp to [-127, 127]
      const clamped = Math.max(-127, Math.min(127, quantized));
      buffer.writeInt8(clamped, quantOffset + j);
    }
  }

  return buffer;
}

/**
 * Build a MiniSearch BM25 index from chunks, serialize and gzip.
 */
function buildBm25Index(chunks: Chunk[], config: OpensonaConfig): Buffer {
  const { fields, boosts } = config.bm25;
  const miniSearch = new MiniSearch({
    fields,
    storeFields: fields,
    searchOptions: {
      boost: boosts,
    },
  });

  const docs = chunks.map((chunk) => ({
    id: chunk.id,
    title: chunk.title,
    header: chunk.header,
    text: chunk.text,
  }));

  miniSearch.addAll(docs);

  const serialized = JSON.stringify(miniSearch);
  return Buffer.from(gzipSync(Buffer.from(serialized, "utf-8")));
}

function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Pack chunks, vectors, and timeline into a bundle of output files.
 */
export async function packBundle(
  chunks: Chunk[],
  vectors: Float32Array,
  dim: number,
  timeline: Timeline,
  config: OpensonaConfig,
): Promise<PackResult> {
  const count = chunks.length;

  // 1. Quantize embeddings to int8
  const embeddingsBuffer = quantizeInt8(vectors, count, dim);

  // 2. Build BM25 index
  const bm25Buffer = buildBm25Index(chunks, config);

  // 3. Gzip chunks JSON
  const chunksJson = JSON.stringify(chunks);
  const chunksBuffer = Buffer.from(gzipSync(Buffer.from(chunksJson, "utf-8")));

  // 4. Compute weightsHash (SHA-256 of the int8 embeddings binary)
  const weightsHash = sha256(embeddingsBuffer);

  // 5. Compute per-file hashes
  const embeddingsHash = weightsHash; // same as above
  const chunksHash = sha256(chunksBuffer);
  const bm25Hash = sha256(bm25Buffer);

  // 6. Count unique articles
  const articleIds = new Set<string>();
  for (const chunk of chunks) {
    articleIds.add(chunk.articleId);
  }

  // 7. Build manifest
  const manifest: Manifest = {
    version: 1,
    buildDate: new Date().toISOString(),
    source: config.source,
    license: config.license,
    embedder: {
      library: "@huggingface/transformers",
      model: config.embedder.model,
      dim: config.embedder.dim,
      weightsHash,
    },
    counts: {
      articles: articleIds.size,
      chunks: count,
      events: timeline.events.length,
    },
    timeline,
    files: {
      embeddings: {
        path: "embeddings.i8.bin",
        sizeBytes: embeddingsBuffer.length,
        sha256: embeddingsHash,
      },
      chunks: {
        path: "chunks.json.gz",
        sizeBytes: chunksBuffer.length,
        sha256: chunksHash,
      },
      bm25: {
        path: "bm25.json.gz",
        sizeBytes: bm25Buffer.length,
        sha256: bm25Hash,
      },
    },
  };

  const manifestJson = JSON.stringify(manifest, null, 2) + "\n";
  const manifestBuffer = Buffer.from(manifestJson, "utf-8");

  // 8. Total size check
  const totalSize =
    manifestBuffer.length + embeddingsBuffer.length + chunksBuffer.length + bm25Buffer.length;

  if (totalSize > config.maxBundleBytes) {
    throw new Error(
      `Bundle size ${(totalSize / 1024 / 1024).toFixed(1)} MB exceeds ` +
        `the ${(config.maxBundleBytes / 1024 / 1024).toFixed(0)} MB limit.`,
    );
  }

  const files = [
    { path: "manifest.json", data: manifestBuffer },
    { path: "embeddings.i8.bin", data: embeddingsBuffer },
    { path: "chunks.json.gz", data: chunksBuffer },
    { path: "bm25.json.gz", data: bm25Buffer },
  ];

  return { manifest, files };
}
