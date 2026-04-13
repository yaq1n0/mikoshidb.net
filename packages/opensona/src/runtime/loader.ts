// packages/opensona/src/runtime/loader.ts
// Idempotent bundle loader — fetches and parses all bundle assets

import MiniSearch from "minisearch";
import type { Chunk, Manifest } from "../types.ts";
import { gunzip } from "./util.ts";

export interface LoadedBundle {
  manifest: Manifest;
  chunks: Chunk[];
  scales: Float32Array;
  quants: Int8Array;
  count: number;
  dim: number;
  bm25: MiniSearch;
}

/** Module-level promise cache keyed by bundlePath for deduplication. */
const loading = new Map<string, Promise<LoadedBundle>>();

export function ensureLoaded(
  bundlePath: string,
  onProgress?: (p: { phase: string; ratio: number }) => void,
): Promise<LoadedBundle> {
  const existing = loading.get(bundlePath);
  if (existing) return existing;

  const promise = doLoad(bundlePath, onProgress);
  loading.set(bundlePath, promise);

  // On failure, allow retry
  promise.catch(() => {
    loading.delete(bundlePath);
  });

  return promise;
}

function progress(
  cb: ((p: { phase: string; ratio: number }) => void) | undefined,
  phase: string,
  ratio: number,
): void {
  if (cb) cb({ phase, ratio });
}

async function doLoad(
  bundlePath: string,
  onProgress?: (p: { phase: string; ratio: number }) => void,
): Promise<LoadedBundle> {
  const base = bundlePath.endsWith("/") ? bundlePath : bundlePath + "/";

  // Step 1: fetch manifest
  progress(onProgress, "manifest", 0);
  const manifestRes = await fetch(base + "manifest.json");
  if (!manifestRes.ok) {
    throw new Error(`Failed to fetch manifest: ${manifestRes.status}`);
  }
  const manifest: Manifest = await manifestRes.json();
  progress(onProgress, "manifest", 1);

  // Validate version
  if (manifest.version !== 1) {
    throw new Error(`Unsupported bundle version: ${manifest.version}`);
  }

  // Validate embedder model is present
  if (!manifest.embedder.model) {
    throw new Error("Bundle manifest is missing embedder.model");
  }

  // Step 2: fetch assets in parallel
  progress(onProgress, "assets", 0);

  const [chunksResult, embeddingsResult, bm25Result] = await Promise.all([
    // chunks.json.gz
    (async () => {
      const res = await fetch(base + "chunks.json.gz");
      if (!res.ok) throw new Error(`Failed to fetch chunks: ${res.status}`);
      const compressed = await res.arrayBuffer();
      progress(onProgress, "assets", 0.2);
      const decompressed = await gunzip(compressed);
      const text = new TextDecoder().decode(decompressed);
      return JSON.parse(text) as Chunk[];
    })(),

    // embeddings.i8.bin
    (async () => {
      const res = await fetch(base + "embeddings.i8.bin");
      if (!res.ok) throw new Error(`Failed to fetch embeddings: ${res.status}`);
      const buf = await res.arrayBuffer();
      progress(onProgress, "assets", 0.5);
      return parseEmbeddings(buf);
    })(),

    // bm25.json.gz
    (async () => {
      const res = await fetch(base + "bm25.json.gz");
      if (!res.ok) throw new Error(`Failed to fetch bm25: ${res.status}`);
      const compressed = await res.arrayBuffer();
      progress(onProgress, "assets", 0.8);
      const decompressed = await gunzip(compressed);
      const text = new TextDecoder().decode(decompressed);
      // Yield so the UI can paint the 0.8 update before the synchronous
      // MiniSearch.loadJSON blocks the main thread.
      await new Promise((r) => setTimeout(r, 0));
      progress(onProgress, "assets", 0.9);
      return MiniSearch.loadJSON(text, {
        fields: ["title", "header", "text"],
        storeFields: ["title", "header", "text"],
      });
    })(),
  ]);

  progress(onProgress, "assets", 1);

  const bundle: LoadedBundle = {
    manifest,
    chunks: chunksResult,
    scales: embeddingsResult.scales,
    quants: embeddingsResult.quants,
    count: embeddingsResult.count,
    dim: embeddingsResult.dim,
    bm25: bm25Result,
  };

  return Object.freeze(bundle);
}

function parseEmbeddings(buf: ArrayBuffer): {
  scales: Float32Array;
  quants: Int8Array;
  count: number;
  dim: number;
} {
  const view = new DataView(buf);
  const count = view.getUint32(0, true);
  const dim = view.getUint32(4, true);

  const headerSize = 8;
  const scalesSize = count * 4;

  const scales = new Float32Array(buf, headerSize, count);
  const quants = new Int8Array(buf, headerSize + scalesSize, count * dim);

  return { scales, quants, count, dim };
}
