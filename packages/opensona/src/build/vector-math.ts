// packages/opensona/src/build/vector-math.ts
// Shared pure-math utilities for embedding vectors

/**
 * Unit-normalize a Float32Array vector in-place (L2 norm).
 * Zero vectors are left unchanged.
 */
export function unitNormalize(vec: Float32Array): void {
  let norm = 0;
  for (let i = 0; i < vec.length; i++) {
    norm += vec[i] * vec[i];
  }
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < vec.length; i++) {
      vec[i] /= norm;
    }
  }
}
