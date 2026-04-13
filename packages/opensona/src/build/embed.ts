// packages/opensona/src/build/embed.ts
// Generate embeddings for chunks using @huggingface/transformers

import { pipeline } from "@huggingface/transformers";
import type { Chunk, OpensonaConfig } from "../types.ts";
import { unitNormalize } from "./vector-math.ts";

/**
 * Embed all chunks using the configured model.
 * Returns a contiguous Float32Array of shape [count * dim] with unit-normalized vectors.
 */
export async function embedChunks(
  chunks: Chunk[],
  config: OpensonaConfig,
  onProgress?: (done: number, total: number) => void,
): Promise<{ vectors: Float32Array; dim: number }> {
  const { model, dim, batchSize } = config.embedder;

  const extractor = await pipeline("feature-extraction", model, {
    dtype: "fp32",
  });

  const total = chunks.length;
  const vectors = new Float32Array(total * dim);

  for (let batchStart = 0; batchStart < total; batchStart += batchSize) {
    const batchEnd = Math.min(batchStart + batchSize, total);
    const texts: string[] = [];

    for (let i = batchStart; i < batchEnd; i++) {
      texts.push(chunks[i].header + "\n" + chunks[i].text);
    }

    const output = await extractor(texts, {
      pooling: "mean",
      normalize: false,
    });

    // output.data is a flat Float32Array of shape [batchCount, dim]
    const data = output.data as Float32Array;
    const batchCount = batchEnd - batchStart;

    for (let i = 0; i < batchCount; i++) {
      const offset = i * dim;
      const globalOffset = (batchStart + i) * dim;
      const vec = new Float32Array(dim);

      for (let j = 0; j < dim; j++) {
        vec[j] = data[offset + j];
      }

      unitNormalize(vec);

      for (let j = 0; j < dim; j++) {
        vectors[globalOffset + j] = vec[j];
      }
    }

    onProgress?.(batchEnd, total);
  }

  return { vectors, dim };
}
