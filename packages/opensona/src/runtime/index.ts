// packages/opensona/src/runtime/index.ts
// Public runtime entry point — wire loader, embedder, retriever, and prompt

export type {
  Chunk,
  EnsureLoadedOptions,
  Manifest,
  OpensonaRuntime,
  QueryOptions,
  RetrievedChunk,
  Timeline,
  TimelineEvent,
} from "../types.ts";

export type { LoadedBundle } from "./loader.ts";
export type { LoreMeta } from "./prompt.ts";

import type {
  EnsureLoadedOptions,
  Manifest,
  OpensonaRuntime,
  QueryOptions,
  RetrievedChunk,
} from "../types.ts";

import type { LoadedBundle } from "./loader.ts";
import { ensureLoaded } from "./loader.ts";
import { embedQuery } from "./embedder.ts";
import { retrieve } from "./retrieve.ts";
export { assembleLorePreamble } from "./prompt.ts";

/**
 * Create a new {@link OpensonaRuntime} instance. The returned object holds no
 * bundle state until `load()` is called. Multiple runtimes can coexist; they
 * share an internal load cache keyed by `bundlePath`.
 */
export function createRuntime(): OpensonaRuntime {
  let bundlePath: string | null = null;
  let loadedBundle: LoadedBundle | null = null;

  return {
    async load(
      path: string,
      arg?: ((p: { phase: string; ratio: number }) => void) | EnsureLoadedOptions,
    ): Promise<void> {
      bundlePath = path;
      loadedBundle = await ensureLoaded(path, arg);
    },

    async query(text: string, options?: QueryOptions): Promise<RetrievedChunk[]> {
      if (!bundlePath) {
        throw new Error("Runtime not loaded. Call load() first.");
      }
      const bundle = loadedBundle ?? (await ensureLoaded(bundlePath));
      const modelId = bundle.manifest.embedder.model;
      const queryVec = await embedQuery(text, modelId);
      const { fused } = retrieve(bundle, queryVec, text, options);
      return fused;
    },

    async inspect(
      text: string,
      options?: QueryOptions,
    ): Promise<{
      dense: RetrievedChunk[];
      bm25: RetrievedChunk[];
      fused: RetrievedChunk[];
    }> {
      if (!bundlePath) {
        throw new Error("Runtime not loaded. Call load() first.");
      }
      const bundle = loadedBundle ?? (await ensureLoaded(bundlePath));
      const modelId = bundle.manifest.embedder.model;
      const queryVec = await embedQuery(text, modelId);
      return retrieve(bundle, queryVec, text, options);
    },

    manifest(): Manifest | null {
      return loadedBundle?.manifest ?? null;
    },
  };
}
