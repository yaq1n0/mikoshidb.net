// packages/opensona/src/types.ts

import { z } from "zod";

export const EditionEraSchema = z
  .object({
    prefix: z.string().min(1),
    label: z.string().min(1),
    startYear: z.number().int(),
    endYear: z.number().int(),
  })
  .strict()
  .refine((e) => e.startYear <= e.endYear, {
    message: "startYear must be <= endYear",
  });

export const CategorySkipRulesSchema = z
  .object({
    prefixes: z.array(z.string()),
    suffixes: z.array(z.string()),
    exact: z.array(z.string()),
  })
  .strict();

export const OpensonaConfigSchema = z
  .object({
    dumpPath: z.string().min(1),
    generatedDir: z.string().min(1),
    source: z.url(),
    license: z.string().min(1),
    embedder: z
      .object({
        model: z.string().min(1),
        dim: z.number().int().positive(),
        batchSize: z.number().int().positive(),
      })
      .strict(),
    chunking: z
      .object({
        targetTokens: z.number().int().positive(),
        maxTokens: z.number().int().positive(),
        overlapTokens: z.number().int().nonnegative(),
      })
      .strict(),
    maxBundleBytes: z.number().int().positive(),
    bm25: z
      .object({
        fields: z.array(z.string().min(1)).min(1),
        boosts: z.record(z.string(), z.number()),
      })
      .strict(),
    timelineArticleTitle: z.string().min(1),
    timelineValidation: z
      .object({
        minYearHeadings: z.number().int().nonnegative(),
        minEvents: z.number().int().nonnegative(),
      })
      .strict(),
    editionEras: z.array(EditionEraSchema),
    categorySkip: CategorySkipRulesSchema,
  })
  .strict();

export type EditionEra = z.infer<typeof EditionEraSchema>;
export type CategorySkipRules = z.infer<typeof CategorySkipRulesSchema>;
export type OpensonaConfig = z.infer<typeof OpensonaConfigSchema>;

/** A single in-universe event on the timeline. */
export interface TimelineEvent {
  /** Slugified unique id, e.g. `"night-city-holocaust-nuclear-device-detonated"`. */
  id: string;
  /** Human-readable name, roughly 80 chars or fewer. */
  name: string;
  /** In-universe year. */
  year: number;
  /** Global total ordering used to compare events with the same year. */
  order: number;
  /** Wiki-linked entity names used for auto-tagging chunks with this event. */
  keywords?: string[];
}

/** Ordered collection of timeline events, stamped into the bundle manifest. */
export interface Timeline {
  events: TimelineEvent[];
}

/** A retrievable unit of lore text, produced by the build pipeline. */
export interface Chunk {
  /** Stable id of the form `articleSlug#chunkIndex`. */
  id: string;
  /** Slugified source article id. */
  articleId: string;
  /** Source article title. */
  title: string;
  /** Breadcrumb header, e.g. `"[Article > Section]"`. */
  header: string;
  /** Chunk body text. */
  text: string;
  /** Timeline event ids that this chunk references. */
  eventIds: string[];
  /** Max `order` among matched events; `-1` means timeless (no events). */
  latestEventOrder: number;
  /** Free-form tags applied during the build (used by `excludeTags`). */
  tags: string[];
  /** Source wiki categories. */
  categories: string[];
}

/** Optional parameters accepted by {@link OpensonaRuntime.query} and `inspect`. */
export interface QueryOptions {
  /** Number of chunks to return after fusion and filtering. Default `3`. */
  topK?: number;
  /** Exclude chunks whose `latestEventOrder` falls after this event's order. */
  cutoffEventId?: string;
  /** Drop chunks carrying any of these tags. */
  excludeTags?: string[];
  /** Custom post-filter applied after built-in filters. */
  filter?: (chunk: Chunk) => boolean;
}

/** A retrieval result: a chunk, its fused score, and which retriever found it. */
export interface RetrievedChunk {
  chunk: Chunk;
  /** Fused score from RRF (`query`) or raw score (`inspect` sub-results). */
  score: number;
  /** Which retriever(s) surfaced the chunk. */
  source: "dense" | "bm25" | "both";
}

/** Bundle manifest written by the build pipeline and consumed at load time. */
export interface Manifest {
  /** Bundle format version. Current runtime supports `1`. */
  version: number;
  /** ISO-8601 build timestamp. */
  buildDate: string;
  /** Attribution URL for the source wiki. */
  source: string;
  /** SPDX-style license string for the source content. */
  license: string;
  /** Embedder identity; the runtime re-uses the same model to embed queries. */
  embedder: {
    library: string;
    model: string;
    dim: number;
    weightsHash: string;
  };
  /** Counts of top-level artifacts in the bundle. */
  counts: { articles: number; chunks: number; events: number };
  /** Full timeline, used for cutoff resolution at query time. */
  timeline: Timeline;
  /** Map of logical file name → `{ path, sizeBytes, sha256 }`. */
  files: Record<string, { path: string; sizeBytes: number; sha256: string }>;
}

/**
 * Opaque handle returned by {@link createRuntime}. Lifecycle:
 * `load()` once, then `query()` / `inspect()` / `manifest()` any number of times.
 */
export interface OpensonaRuntime {
  /**
   * Load and decompress a bundle from `bundlePath` (directory URL or fs path,
   * with or without a trailing slash). Idempotent — concurrent calls for the
   * same path are deduplicated. A failed load allows a subsequent retry.
   *
   * @param bundlePath Location of the bundle directory containing
   *   `manifest.json`, `chunks.json.gz`, `embeddings.i8.bin`, `bm25.json.gz`.
   * @param onProgress Optional callback invoked with `{ phase, ratio }` updates
   *   as the manifest and assets are fetched and parsed.
   */
  load(
    bundlePath: string,
    onProgress?: (p: { phase: string; ratio: number }) => void,
  ): Promise<void>;

  /**
   * Run hybrid retrieval (dense + BM25, fused via RRF) and return the top-k
   * chunks after timeline, tag, and custom filters are applied.
   *
   * @throws If the runtime has not been loaded.
   */
  query(text: string, options?: QueryOptions): Promise<RetrievedChunk[]>;

  /**
   * Like {@link query}, but returns the intermediate dense and BM25 result
   * sets alongside the fused output. Useful for debugging retrieval quality.
   *
   * @throws If the runtime has not been loaded.
   */
  inspect(
    text: string,
    options?: QueryOptions,
  ): Promise<{
    dense: RetrievedChunk[];
    bm25: RetrievedChunk[];
    fused: RetrievedChunk[];
  }>;

  /** Returns the loaded {@link Manifest}, or `null` if `load()` has not completed. */
  manifest(): Manifest | null;
}
