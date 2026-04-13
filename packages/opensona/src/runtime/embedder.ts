// packages/opensona/src/runtime/embedder.ts
// Query embedding via @huggingface/transformers (dynamically imported)

import { unitNormalize } from "../build/vector-math.ts";

type FeatureExtractionPipeline = (
  text: string,
  options: { pooling: string; normalize: boolean },
) => Promise<{ data: Float32Array; dims: number[] }>;

/** Cached pipeline, keyed by model ID to support manifest-driven model selection. */
let cachedModelId: string | null = null;
let pipelinePromise: Promise<FeatureExtractionPipeline> | null = null;

function getPipeline(modelId: string): Promise<FeatureExtractionPipeline> {
  if (pipelinePromise && cachedModelId === modelId) return pipelinePromise;

  cachedModelId = modelId;
  pipelinePromise = (async () => {
    const { pipeline } = await import("@huggingface/transformers");
    const pipe = await pipeline("feature-extraction", modelId);
    return pipe as unknown as FeatureExtractionPipeline;
  })();

  return pipelinePromise;
}

/**
 * Embed a query string using the model specified in the manifest.
 * @param text - The query text to embed
 * @param modelId - The embedding model ID (from manifest.embedder.model)
 */
export async function embedQuery(text: string, modelId: string): Promise<Float32Array> {
  const pipe = await getPipeline(modelId);
  const output = await pipe(text, { pooling: "mean", normalize: false });

  const vec = output.data instanceof Float32Array ? output.data : new Float32Array(output.data);

  unitNormalize(vec);

  return vec;
}
