// packages/opensona/src/runtime/loader.ts
// Idempotent bundle loader — fetches and parses all bundle assets

import MiniSearch from "minisearch";
import type { Chunk, EnsureLoadedOptions, Manifest } from "../types.ts";
import { gunzip } from "./util.ts";

type ProgressCb = (p: { phase: string; ratio: number }) => void;
type EnsureLoadedArg = ProgressCb | EnsureLoadedOptions;

function normalizeOptions(arg?: EnsureLoadedArg): EnsureLoadedOptions {
  return typeof arg === "function" ? { onProgress: arg } : (arg ?? {});
}

/**
 * Parsed and in-memory form of a bundle, returned by the loader. Exposed so
 * downstream tooling can build custom retrieval pipelines; the standard
 * runtime consumes this via {@link createRuntime} and callers normally do not
 * interact with it directly.
 */
export interface LoadedBundle {
  manifest: Manifest;
  chunks: Chunk[];
  /** Per-vector scale factors used to dequantise `quants`. */
  scales: Float32Array;
  /** Int8-quantised embeddings laid out as `count * dim` contiguous values. */
  quants: Int8Array;
  /** Number of chunks / vectors. */
  count: number;
  /** Embedding dimensionality. */
  dim: number;
  /** MiniSearch instance populated from the bundle's BM25 index. */
  bm25: MiniSearch;
}

/** Module-level promise cache keyed by bundlePath for deduplication. */
const loading = new Map<string, Promise<LoadedBundle>>();

export function ensureLoaded(bundlePath: string, arg?: EnsureLoadedArg): Promise<LoadedBundle> {
  const existing = loading.get(bundlePath);
  if (existing) return existing;

  const promise = doLoad(bundlePath, normalizeOptions(arg));
  loading.set(bundlePath, promise);

  // On failure, allow retry
  promise.catch(() => {
    loading.delete(bundlePath);
  });

  return promise;
}

function progress(cb: ProgressCb | undefined, phase: string, ratio: number): void {
  if (cb) cb({ phase, ratio });
}

/** Fetch `name` either via the override (passing the manifest sha256) or the
 * global fetch. Returns the raw Response so the caller can pick arrayBuffer/json. */
async function fetchAsset(
  url: string,
  name: string,
  manifest: Manifest,
  fetchOverride: EnsureLoadedOptions["fetchOverride"],
): Promise<Response> {
  if (fetchOverride) {
    const sha = manifest.files[name]?.sha256 ?? "";
    return fetchOverride(url, sha);
  }
  return fetch(url);
}

async function doLoad(bundlePath: string, opts: EnsureLoadedOptions): Promise<LoadedBundle> {
  const { onProgress, fetchOverride } = opts;
  const base = bundlePath.endsWith("/") ? bundlePath : bundlePath + "/";

  // Step 1: fetch manifest (no sha256 known yet — pass empty string to override)
  progress(onProgress, "manifest", 0);
  const manifestRes = await (fetchOverride
    ? fetchOverride(base + "manifest.json", "")
    : fetch(base + "manifest.json"));
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
      const res = await fetchAsset(base + "chunks.json.gz", "chunks", manifest, fetchOverride);
      if (!res.ok) throw new Error(`Failed to fetch chunks: ${res.status}`);
      const compressed = await res.arrayBuffer();
      progress(onProgress, "assets", 0.2);
      const decompressed = await gunzip(compressed);
      const text = new TextDecoder().decode(decompressed);
      return JSON.parse(text) as Chunk[];
    })(),

    // embeddings.i8.bin
    (async () => {
      const res = await fetchAsset(
        base + "embeddings.i8.bin",
        "embeddings",
        manifest,
        fetchOverride,
      );
      if (!res.ok) throw new Error(`Failed to fetch embeddings: ${res.status}`);
      const buf = await res.arrayBuffer();
      progress(onProgress, "assets", 0.5);
      return parseEmbeddings(buf);
    })(),

    // bm25.json.gz
    (async () => {
      const res = await fetchAsset(base + "bm25.json.gz", "bm25", manifest, fetchOverride);
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
