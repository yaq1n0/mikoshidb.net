// packages/opensona/src/runtime/index.ts
// Public runtime entry point — graph retrieval. LLM-agnostic.

export type {
  CharacterContext,
  Chunk,
  EnsureLoadedOptions,
  EntityVocab,
  GetTraversalPath,
  Manifest,
  OpensonaRuntime,
  QueryOptions,
  ResolverInput,
  RetrievedChunk,
  Timeline,
  TimelineEvent,
  TraversalDirective,
} from "../types.ts";

export type { LoadedGraph } from "./graph.ts";
export type { LoreMeta } from "./prompt.ts";
export type { ResolverMessage } from "./resolve.ts";
export type { TraverseTrace } from "./traverse.ts";

import type {
  EnsureLoadedOptions,
  EntityVocab,
  Manifest,
  OpensonaRuntime,
  QueryOptions,
  RetrievedChunk,
} from "../types.ts";

import type { LoadedGraph } from "./graph.ts";
import { ensureLoaded } from "./loader.ts";
import { warmEngram } from "./resolve.ts";
import { traverse } from "./traverse.ts";

export { assembleLorePreamble } from "./prompt.ts";
export { buildResolverMessages, parseTraversalDirective, warmEngram } from "./resolve.ts";
export { traverse } from "./traverse.ts";

/**
 * Create a new {@link OpensonaRuntime}. The returned object holds no bundle
 * state until `load()` is called.
 */
export const createRuntime = (): OpensonaRuntime => {
  let bundlePath: string | null = null;
  let loadedGraph: LoadedGraph | null = null;
  const vocabCache = new Map<string, EntityVocab>();

  const ensureGraph = async (): Promise<LoadedGraph> => {
    if (loadedGraph) return loadedGraph;
    if (!bundlePath) throw new Error("Runtime not loaded. Call load() first.");
    loadedGraph = await ensureLoaded(bundlePath);
    return loadedGraph;
  };

  return {
    async load(
      path: string,
      arg?: ((p: { phase: string; ratio: number }) => void) | EnsureLoadedOptions,
    ): Promise<void> {
      bundlePath = path;
      loadedGraph = await ensureLoaded(path, arg);
      vocabCache.clear();
    },

    async query(userQuery: string, options: QueryOptions): Promise<RetrievedChunk[]> {
      const graph = await ensureGraph();
      const { getTraversalPath, characterContext, onTrace } = options;

      let vocab = vocabCache.get(characterContext.id);
      if (!vocab) {
        vocab = warmEngram(characterContext.id, graph);
        vocabCache.set(characterContext.id, vocab);
      }

      let directive;
      try {
        directive = await getTraversalPath({
          userQuery,
          characterContext,
          entityVocab: vocab,
        });
      } catch {
        return [];
      }
      if (!directive || directive.entities.length === 0) return [];

      const { chunks, trace } = traverse(directive, graph, characterContext);
      if (onTrace) onTrace(trace, directive);
      return chunks;
    },

    warmEngram(engramId: string): EntityVocab {
      if (!loadedGraph) {
        throw new Error("Runtime not loaded. Call load() first.");
      }
      let vocab = vocabCache.get(engramId);
      if (!vocab) {
        vocab = warmEngram(engramId, loadedGraph);
        vocabCache.set(engramId, vocab);
      }
      return vocab;
    },

    manifest(): Manifest | null {
      return loadedGraph?.manifest ?? null;
    },
  };
};
