// packages/opensona/src/runtime/prompt.ts
// Assemble lore preamble from retrieved chunks

import type { RetrievedChunk } from "../types.ts";

/** Attribution stamped onto the assembled `<lore>` block. */
export interface LoreMeta {
  /** Attribution URL for the source wiki; typically `manifest.source`. */
  source: string;
  /** Licence string for the source content; typically `manifest.license`. */
  license: string;
}

/**
 * Format retrieved chunks into a `<lore>` block suitable for prepending to an
 * LLM system message. Returns an empty string when `chunks` is empty so callers
 * can unconditionally concatenate the result.
 */
export function assembleLorePreamble(chunks: RetrievedChunk[], meta: LoreMeta): string {
  if (chunks.length === 0) return "";

  const lines = chunks.map((r) => r.chunk.header + " " + r.chunk.text);
  const body = lines.join("\n");

  return `<lore source="${meta.source}, ${meta.license}">
${body}
</lore>

The above lore is what your memory contains about the topic at hand. It is reference material — use it to stay accurate, but speak in your own voice and never quote it verbatim or reference "the lore" out loud. If the lore conflicts with your dossier, your dossier wins.`;
}
