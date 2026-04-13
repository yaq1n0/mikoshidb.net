// packages/opensona/src/runtime/retrieve.ts
// Hybrid dense + BM25 retrieval with RRF fusion

import type { Chunk, QueryOptions, RetrievedChunk } from "../types.ts";
import type { LoadedBundle } from "./loader.ts";

export function retrieve(
  bundle: LoadedBundle,
  queryVec: Float32Array,
  queryText: string,
  options?: QueryOptions,
): { dense: RetrievedChunk[]; bm25: RetrievedChunk[]; fused: RetrievedChunk[] } {
  const topK = options?.topK ?? 3;
  const excludeTags = options?.excludeTags ?? [];
  const excludeSet = new Set(excludeTags);
  const filterFn = options?.filter;

  // Resolve timeline cutoff
  let cutoffOrder = Infinity;
  if (options?.cutoffEventId && options.cutoffEventId !== "__LAST_EVENT__") {
    const evt = bundle.manifest.timeline.events.find((e) => e.id === options!.cutoffEventId);
    if (evt) {
      cutoffOrder = evt.order;
    }
    // If not found, leave as Infinity (no filter)
  }

  const { chunks, scales, quants, count, dim } = bundle;

  // --- Dense scoring ---
  const denseScored: { idx: number; score: number }[] = [];

  for (let k = 0; k < count; k++) {
    const chunk = chunks[k];

    // Timeline filter: skip if chunk is after cutoff (but -1 = timeless, always include)
    if (chunk.latestEventOrder !== -1 && chunk.latestEventOrder > cutoffOrder) {
      continue;
    }

    // Tag filter
    if (excludeSet.size > 0) {
      let excluded = false;
      for (const tag of chunk.tags) {
        if (excludeSet.has(tag)) {
          excluded = true;
          break;
        }
      }
      if (excluded) continue;
    }

    // Dot product
    let sum = 0;
    const base = k * dim;
    for (let j = 0; j < dim; j++) {
      sum += queryVec[j] * quants[base + j];
    }
    const score = scales[k] * sum;

    denseScored.push({ idx: k, score });
  }

  // Sort descending, take top 20
  denseScored.sort((a, b) => b.score - a.score);
  const denseTop = denseScored.slice(0, 20);

  const denseResults: RetrievedChunk[] = denseTop.map((d) => ({
    chunk: chunks[d.idx],
    score: d.score,
    source: "dense" as const,
  }));

  // --- BM25 scoring ---
  const bm25Raw = bundle.bm25.search(queryText, {
    fuzzy: 0.2,
    prefix: true,
  });

  // Build chunk lookup by id for filtering
  const chunkById = new Map<string, Chunk>();
  for (const chunk of chunks) {
    chunkById.set(chunk.id, chunk);
  }

  // Filter and take top 20
  const bm25Filtered: { chunk: Chunk; score: number }[] = [];
  for (const result of bm25Raw) {
    const chunk = chunkById.get(result.id as string);
    if (!chunk) continue;

    // Timeline filter
    if (chunk.latestEventOrder !== -1 && chunk.latestEventOrder > cutoffOrder) {
      continue;
    }

    // Tag filter
    if (excludeSet.size > 0) {
      let excluded = false;
      for (const tag of chunk.tags) {
        if (excludeSet.has(tag)) {
          excluded = true;
          break;
        }
      }
      if (excluded) continue;
    }

    bm25Filtered.push({ chunk, score: result.score });
    if (bm25Filtered.length >= 20) break;
  }

  const bm25Results: RetrievedChunk[] = bm25Filtered.map((b) => ({
    chunk: b.chunk,
    score: b.score,
    source: "bm25" as const,
  }));

  // --- RRF fusion ---
  const rrfScores = new Map<
    string,
    { chunk: Chunk; score: number; inDense: boolean; inBm25: boolean }
  >();

  for (let rank = 0; rank < denseResults.length; rank++) {
    const r = denseResults[rank];
    const rrfScore = 1 / (60 + rank);
    const entry = rrfScores.get(r.chunk.id);
    if (entry) {
      entry.score += rrfScore;
      entry.inDense = true;
    } else {
      rrfScores.set(r.chunk.id, { chunk: r.chunk, score: rrfScore, inDense: true, inBm25: false });
    }
  }

  for (let rank = 0; rank < bm25Results.length; rank++) {
    const r = bm25Results[rank];
    const rrfScore = 1 / (60 + rank);
    const entry = rrfScores.get(r.chunk.id);
    if (entry) {
      entry.score += rrfScore;
      entry.inBm25 = true;
    } else {
      rrfScores.set(r.chunk.id, { chunk: r.chunk, score: rrfScore, inDense: false, inBm25: true });
    }
  }

  let fusedList = Array.from(rrfScores.values()).map((e) => ({
    chunk: e.chunk,
    score: e.score,
    source: (e.inDense && e.inBm25
      ? "both"
      : e.inDense
        ? "dense"
        : "bm25") as RetrievedChunk["source"],
  }));

  // Apply consumer filter
  if (filterFn) {
    fusedList = fusedList.filter((r) => filterFn(r.chunk));
  }

  // Sort descending by score, take topK
  fusedList.sort((a, b) => b.score - a.score);
  const fusedResults = fusedList.slice(0, topK);

  return { dense: denseResults, bm25: bm25Results, fused: fusedResults };
}
