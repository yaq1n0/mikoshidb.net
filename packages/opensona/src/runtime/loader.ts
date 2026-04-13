// packages/opensona/src/runtime/loader.ts
// Idempotent graph bundle loader — fetches and hydrates the v2 bundle.

import type { EnsureLoadedOptions, Manifest } from "../types.ts";
import { gunzip } from "./util.ts";
import {
  hydrateGraph,
  type LoadedGraph,
  type RawEdgesPayload,
  type RawNodesPayload,
} from "./graph.ts";

type ProgressCb = (p: { phase: string; ratio: number }) => void;
type EnsureLoadedArg = ProgressCb | EnsureLoadedOptions;

function normalizeOptions(arg?: EnsureLoadedArg): EnsureLoadedOptions {
  return typeof arg === "function" ? { onProgress: arg } : (arg ?? {});
}

const loading = new Map<string, Promise<LoadedGraph>>();

export function ensureLoaded(bundlePath: string, arg?: EnsureLoadedArg): Promise<LoadedGraph> {
  const existing = loading.get(bundlePath);
  if (existing) return existing;

  const promise = doLoad(bundlePath, normalizeOptions(arg));
  loading.set(bundlePath, promise);

  promise.catch(() => {
    loading.delete(bundlePath);
  });

  return promise;
}

function progress(cb: ProgressCb | undefined, phase: string, ratio: number): void {
  if (cb) cb({ phase, ratio });
}

async function fetchAsset(
  url: string,
  name: "nodes" | "edges" | "aliases",
  manifest: Manifest,
  fetchOverride: EnsureLoadedOptions["fetchOverride"],
): Promise<Response> {
  if (fetchOverride) {
    const sha = manifest.files[name]?.sha256 ?? "";
    return fetchOverride(url, sha);
  }
  return fetch(url);
}

async function doLoad(bundlePath: string, opts: EnsureLoadedOptions): Promise<LoadedGraph> {
  const { onProgress, fetchOverride } = opts;
  const base = bundlePath.endsWith("/") ? bundlePath : bundlePath + "/";

  progress(onProgress, "manifest", 0);
  const manifestRes = await (fetchOverride
    ? fetchOverride(base + "manifest.json", "")
    : fetch(base + "manifest.json"));
  if (!manifestRes.ok) {
    throw new Error(`Failed to fetch manifest: ${manifestRes.status}`);
  }
  const manifest: Manifest = await manifestRes.json();
  progress(onProgress, "manifest", 1);

  if (manifest.version !== 2) {
    throw new Error(
      `Unsupported bundle version: ${manifest.version} (runtime requires v2 / graph retrieval)`,
    );
  }
  if (manifest.retrieval !== "graph") {
    throw new Error(`Unsupported retrieval kind: ${manifest.retrieval}`);
  }

  progress(onProgress, "assets", 0);

  const [nodes, edges, aliases] = await Promise.all([
    (async () => {
      const res = await fetchAsset(base + "graph-nodes.json.gz", "nodes", manifest, fetchOverride);
      if (!res.ok) throw new Error(`Failed to fetch graph-nodes: ${res.status}`);
      const compressed = await res.arrayBuffer();
      progress(onProgress, "assets", 0.3);
      const decompressed = await gunzip(compressed);
      const text = new TextDecoder().decode(decompressed);
      return JSON.parse(text) as RawNodesPayload;
    })(),
    (async () => {
      const res = await fetchAsset(base + "graph-edges.json.gz", "edges", manifest, fetchOverride);
      if (!res.ok) throw new Error(`Failed to fetch graph-edges: ${res.status}`);
      const compressed = await res.arrayBuffer();
      progress(onProgress, "assets", 0.6);
      const decompressed = await gunzip(compressed);
      const text = new TextDecoder().decode(decompressed);
      return JSON.parse(text) as RawEdgesPayload;
    })(),
    (async () => {
      const res = await fetchAsset(base + "aliases.json.gz", "aliases", manifest, fetchOverride);
      if (!res.ok) throw new Error(`Failed to fetch aliases: ${res.status}`);
      const compressed = await res.arrayBuffer();
      progress(onProgress, "assets", 0.85);
      const decompressed = await gunzip(compressed);
      const text = new TextDecoder().decode(decompressed);
      return JSON.parse(text) as Record<string, string>;
    })(),
  ]);

  progress(onProgress, "assets", 0.95);
  const graph = hydrateGraph(manifest, nodes, edges, aliases);
  progress(onProgress, "assets", 1);

  return graph;
}
