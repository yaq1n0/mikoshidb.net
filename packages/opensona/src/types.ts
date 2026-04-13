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

export interface TimelineEvent {
  id: string;
  name: string;
  year: number;
  order: number;
  keywords?: string[];
}

export interface Timeline {
  events: TimelineEvent[];
}

export interface Chunk {
  id: string;
  articleId: string;
  title: string;
  header: string;
  text: string;
  eventIds: string[];
  latestEventOrder: number;
  tags: string[];
  categories: string[];
}

export interface QueryOptions {
  topK?: number;
  cutoffEventId?: string;
  excludeTags?: string[];
  filter?: (chunk: Chunk) => boolean;
}

export interface RetrievedChunk {
  chunk: Chunk;
  score: number;
  source: "dense" | "bm25" | "both";
}

export interface Manifest {
  version: number;
  buildDate: string;
  source: string;
  license: string;
  embedder: {
    library: string;
    model: string;
    dim: number;
    weightsHash: string;
  };
  counts: { articles: number; chunks: number; events: number };
  timeline: Timeline;
  files: Record<string, { path: string; sizeBytes: number; sha256: string }>;
}

export interface OpersonaRuntime {
  load(
    bundlePath: string,
    onProgress?: (p: { phase: string; ratio: number }) => void,
  ): Promise<void>;
  query(text: string, options?: QueryOptions): Promise<RetrievedChunk[]>;
  inspect(
    text: string,
    options?: QueryOptions,
  ): Promise<{
    dense: RetrievedChunk[];
    bm25: RetrievedChunk[];
    fused: RetrievedChunk[];
  }>;
  manifest(): Manifest | null;
}
