// packages/opensona/src/runtime/traverse.ts
// Pure graph traversal. Given a directive + character context, return chunks.

import type {
  CharacterContext,
  Chunk,
  RetrievedChunk,
  TraversalDirective,
  TraverseTrace,
} from "../types.ts";
import type { LoadedGraph } from "./graph.ts";
import { resolveAlias } from "../build/aliases.ts";
import { slugify } from "../build/parse.ts";

export type { TraverseTrace } from "../types.ts";

export type TraverseOptions = {
  /** Soft cap on emitted chunks. Default 40. */
  maxChunks?: number;
};

const DEFAULT_MAX_CHUNKS = 40;

function resolveCutoffOrder(characterContext: CharacterContext, graph: LoadedGraph): number {
  const cutoff = characterContext.cutoffEventId;
  if (!cutoff || cutoff === "__LAST_EVENT__") return Infinity;
  const order = graph.eventOrder.get(cutoff);
  return order ?? Infinity;
}

function passesCutoff(latestEventOrder: number, cutoffOrder: number): boolean {
  if (latestEventOrder === -1) return true;
  return latestEventOrder <= cutoffOrder;
}

function passesTags(tags: string[], excluded: Set<string>): boolean {
  if (excluded.size === 0) return true;
  for (const t of tags) if (excluded.has(t)) return false;
  return true;
}

export function traverse(
  directive: TraversalDirective,
  graph: LoadedGraph,
  characterContext: CharacterContext,
  options?: TraverseOptions,
): { chunks: RetrievedChunk[]; trace: TraverseTrace } {
  const trace: TraverseTrace = {
    resolvedEntities: [],
    unresolvedEntities: [],
    nodes: [],
  };
  const maxChunks = options?.maxChunks ?? DEFAULT_MAX_CHUNKS;
  const cutoffOrder = resolveCutoffOrder(characterContext, graph);
  const excludedTags = new Set(characterContext.excludeTags ?? []);

  // 1. Resolve entity strings to article ids.
  const seedSlugs: string[] = [];
  const seen = new Set<string>();
  for (const entity of directive.entities) {
    const slug = resolveAlias(entity, graph.aliases);
    if (!slug || !graph.articles.has(slug)) {
      trace.unresolvedEntities.push(entity);
      continue;
    }
    if (seen.has(slug)) continue;
    seen.add(slug);
    seedSlugs.push(slug);
    trace.resolvedEntities.push({ alias: entity, articleId: slug });
  }

  // 2. Add include_categories: enqueue all articles under those categories.
  const categorySeedSlugs = new Set<string>();
  for (const rawCat of directive.include_categories) {
    const catId = slugify(rawCat);
    const cat = graph.categories.get(catId) ?? graph.categories.get(rawCat);
    if (!cat) continue;
    for (const a of cat.articleIds) {
      if (!seen.has(a)) categorySeedSlugs.add(a);
    }
  }

  // 3. BFS from seeds, bounded by directive.neighbors.
  const maxHops = directive.neighbors === "two_hop" ? 2 : directive.neighbors === "direct" ? 1 : 0;

  const chunks: RetrievedChunk[] = [];
  const emit = (
    articleId: string,
    hops: number,
    source: "lead" | "section" | "neighbor",
    overrideText?: string,
    sectionId?: string,
  ): void => {
    if (chunks.length >= maxChunks) return;
    const article = graph.articles.get(articleId);
    if (!article) {
      trace.nodes.push({
        id: sectionId ?? articleId,
        kind: source === "section" ? "section" : source === "lead" ? "article-lead" : "neighbor",
        hops,
        included: false,
        droppedReason: "unknown-article",
      });
      return;
    }

    const isSection = source === "section" && sectionId !== undefined;
    const sourceNode = isSection ? graph.sections.get(sectionId) : undefined;

    const latest = isSection && sourceNode ? sourceNode.latestEventOrder : article.latestEventOrder;
    const tags = isSection && sourceNode ? sourceNode.tags : article.tags;
    const eventIds = isSection && sourceNode ? sourceNode.eventIds : article.eventIds;

    if (!passesCutoff(latest, cutoffOrder)) {
      trace.nodes.push({
        id: sectionId ?? articleId,
        kind: source === "section" ? "section" : source === "lead" ? "article-lead" : "neighbor",
        hops,
        included: false,
        droppedReason: "cutoff",
      });
      return;
    }
    if (!passesTags(tags, excludedTags)) {
      trace.nodes.push({
        id: sectionId ?? articleId,
        kind: source === "section" ? "section" : source === "lead" ? "article-lead" : "neighbor",
        hops,
        included: false,
        droppedReason: "excluded-tag",
      });
      return;
    }

    const text =
      overrideText ?? (isSection && sourceNode ? sourceNode.text : article.lead || article.title);
    const header =
      isSection && sourceNode
        ? `[${article.title} > ${sourceNode.heading || "intro"}]`
        : `[${article.title}]`;

    const chunk: Chunk = {
      id: sectionId ?? articleId,
      articleId,
      title: article.title,
      header,
      text,
      eventIds,
      latestEventOrder: latest,
      tags,
      categories: article.categories,
    };

    chunks.push({
      chunk,
      source,
      hops,
    });

    trace.nodes.push({
      id: chunk.id,
      kind: source === "section" ? "section" : source === "lead" ? "article-lead" : "neighbor",
      hops,
      included: true,
    });
  };

  const visited = new Set<string>();
  type QueueItem = { id: string; hops: number; isSeed: boolean };
  const queue: QueueItem[] = [
    ...seedSlugs.map<QueueItem>((id) => ({ id, hops: 0, isSeed: true })),
    ...[...categorySeedSlugs].map<QueueItem>((id) => ({ id, hops: 1, isSeed: false })),
  ];

  while (queue.length > 0 && chunks.length < maxChunks) {
    const { id, hops, isSeed } = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);

    const article = graph.articles.get(id);
    if (!article) {
      trace.nodes.push({
        id,
        kind: "neighbor",
        hops,
        included: false,
        droppedReason: "unknown-article",
      });
      continue;
    }

    if (isSeed) {
      emit(id, hops, "lead");
      for (const sid of article.sectionIds) {
        emit(id, hops, "section", undefined, sid);
      }
    } else {
      emit(id, hops, "neighbor");
    }

    if (hops < maxHops) {
      const neighbors = graph.edges.links.get(id);
      if (neighbors) {
        for (const n of neighbors) {
          if (!visited.has(n)) queue.push({ id: n, hops: hops + 1, isSeed: false });
        }
      }
    }
  }

  // Stable sort: by hops asc, then by id for determinism.
  chunks.sort((a, b) => {
    if (a.hops !== b.hops) return a.hops - b.hops;
    return a.chunk.id.localeCompare(b.chunk.id);
  });

  return { chunks, trace };
}
