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

export const GraphBuildOptionsSchema = z
  .object({
    sectionMaxChars: z.number().int().positive(),
    leadMaxChars: z.number().int().positive(),
    dropDeadLinks: z.boolean(),
    includeMentionsEdges: z.boolean(),
  })
  .strict();

export const OpensonaConfigSchema = z
  .object({
    dumpPath: z.string().min(1),
    generatedDir: z.string().min(1),
    source: z.url(),
    license: z.string().min(1),
    graph: GraphBuildOptionsSchema,
    maxBundleBytes: z.number().int().positive(),
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
export type GraphBuildOptions = z.infer<typeof GraphBuildOptionsSchema>;
export type OpensonaConfig = z.infer<typeof OpensonaConfigSchema>;

/** A single in-universe event on the timeline. */
export type TimelineEvent = {
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
};

/** Ordered collection of timeline events, stamped into the bundle manifest. */
export type Timeline = {
  events: TimelineEvent[];
};

/** Metadata stamped into the manifest for traceability. */
export type TimelineMeta = {
  articleTitle: string;
  eventCount: number;
  minYear: number;
  maxYear: number;
};

/** A retrievable unit of lore text, produced by graph traversal. */
export type Chunk = {
  /** Stable id, e.g. article slug or `${slug}#${sectionIndex}`. */
  id: string;
  /** Slugified source article id. */
  articleId: string;
  /** Source article title. */
  title: string;
  /** Breadcrumb header, e.g. `"[Article > Section]"` or `"[Article]"`. */
  header: string;
  /** Body text (article lead, section text, or a short neighbor snippet). */
  text: string;
  /** Timeline event ids associated with the source node. */
  eventIds: string[];
  /** Max `order` among matched events; `-1` means timeless (no events). */
  latestEventOrder: number;
  /** Free-form tags (category slugs, typically). */
  tags: string[];
  /** Source wiki categories. */
  categories: string[];
};

/**
 * A retrieval result from graph traversal.
 *
 * `source` identifies whether this chunk is the resolved entity's lead, one of
 * its sections, or a neighbor reached via links. `hops` is the link distance
 * from the resolved entity (0 for the entity itself); results are ordered by
 * ascending `hops`.
 */
export type RetrievedChunk = {
  chunk: Chunk;
  source: "lead" | "section" | "neighbor";
  /** Number of link hops from the resolved entity (0 for the entity itself). */
  hops: number;
};

/** Caller-supplied projection of an engram, used to ground retrieval. */
export type CharacterContext = {
  /** Article id / slug the engram corresponds to (used to anchor neighborhoods). */
  id: string;
  /** Short bio — used by the resolver prompt as extra context. */
  bio: string;
  /** Timeline event id — chunks whose `latestEventOrder` exceeds this are filtered out. */
  cutoffEventId?: string;
  /** Tag slugs; chunks carrying any of these are filtered out. */
  excludeTags?: string[];
};

/** Entity vocabulary opensona computes per character switch. */
export type EntityVocab = {
  engramId: string;
  /** Roughly 80–150 aliases: the engram's own article plus 1-hop link neighbors. */
  names: string[];
  /** Top-level categories touched by the neighborhood. */
  categories: string[];
};

/** Input opensona hands to the resolver callback. */
export type ResolverInput = {
  userQuery: string;
  characterContext: CharacterContext;
  entityVocab: EntityVocab;
};

/** Output the resolver callback is expected to return. */
export type TraversalDirective = {
  /** Alias strings from `entityVocab.names` that anchor the retrieval. */
  entities: string[];
  /** How aggressively to expand from the resolved entities. */
  neighbors: "none" | "direct" | "two_hop";
  /** Extra categories to widen the pull with. */
  include_categories: string[];
  reasoning?: string;
};

/**
 * The callback contract. Callers wire this to their LLM of choice (opensona is
 * LLM-agnostic). Return `null` to signal "no plan" — the runtime yields `[]`.
 */
export type GetTraversalPath = (input: ResolverInput) => Promise<TraversalDirective | null>;

/** Options accepted by {@link OpensonaRuntime.query}. */
export type QueryOptions = {
  getTraversalPath: GetTraversalPath;
  characterContext: CharacterContext;
  /**
   * Optional diagnostic hook. Fires once per query, after traversal completes,
   * with the trace emitted by the graph walker and the directive that produced
   * it. Skipped when the resolver yields no directive or throws.
   */
  onTrace?: (trace: TraverseTrace, directive: TraversalDirective) => void;
};

/**
 * Diagnostic trace for a single traversal. Shape mirrors
 * `runtime/traverse.ts#TraverseTrace`; re-declared here to keep `types.ts`
 * free of runtime imports.
 */
export type TraverseTrace = {
  resolvedEntities: Array<{ alias: string; articleId: string }>;
  unresolvedEntities: string[];
  nodes: Array<{
    id: string;
    kind: "article-lead" | "section" | "neighbor";
    hops: number;
    included: boolean;
    droppedReason?: "cutoff" | "excluded-tag" | "unknown-article";
  }>;
};

/** File metadata stamped in the manifest for each bundle asset. */
export type FileMeta = {
  path: string;
  sizeBytes: number;
  sha256: string;
};

/** Bundle manifest written by the graph build pipeline. */
export type Manifest = {
  /** Bundle format version. Current runtime supports `2`. */
  version: 2;
  /** Retrieval kind. Always `"graph"`. */
  retrieval: "graph";
  /** ISO-8601 build timestamp. */
  buildDate: string;
  /** Attribution URL for the source wiki. */
  source: string;
  /** SPDX-style license string for the source content. */
  license: string;
  /** Graph build parameters, for traceability. */
  graph: {
    sectionMaxChars: number;
    leadMaxChars: number;
    deadLinkCount: number;
  };
  /** Counts of top-level artifacts in the bundle. */
  counts: {
    articles: number;
    sections: number;
    categories: number;
    aliases: number;
    edges: number;
    events: number;
  };
  /** Full timeline, used for cutoff resolution at query time. */
  timeline: Timeline;
  /** Source-timeline metadata. */
  timelineMeta: TimelineMeta;
  /** Map of logical file name → `{ path, sizeBytes, sha256 }`. */
  files: Record<string, FileMeta>;
};

/** Options bag accepted by `ensureLoaded` / `OpensonaRuntime.load`. */
export type EnsureLoadedOptions = {
  onProgress?: (p: { phase: string; ratio: number }) => void;
  /**
   * Optional per-file fetch hook. When provided, the loader calls this in
   * place of the global `fetch` for each bundle asset, passing the resolved
   * URL and the manifest's expected SHA-256 for that asset.
   */
  fetchOverride?: (url: string, expectedSha256: string) => Promise<Response>;
};

/**
 * Public runtime handle. Lifecycle: `load()` once, then `query()` /
 * `warmEngram()` / `manifest()` any number of times.
 */
export type OpensonaRuntime = {
  load(
    bundlePath: string,
    arg?: ((p: { phase: string; ratio: number }) => void) | EnsureLoadedOptions,
  ): Promise<void>;

  /**
   * Run graph traversal and return the chunks the resolver + traversal
   * selected. Returns `[]` if the resolver yields no directive or errors.
   */
  query(userQuery: string, options: QueryOptions): Promise<RetrievedChunk[]>;

  /**
   * Pre-compute and cache the entity vocabulary for an engram. Idempotent.
   * Returns the vocabulary for inspection; the runtime also keeps it internally.
   */
  warmEngram(engramId: string): EntityVocab;

  /** Returns the loaded {@link Manifest}, or `null` if `load()` has not completed. */
  manifest(): Manifest | null;
};
