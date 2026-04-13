// packages/opensona/src/runtime/graph.ts
// Hydrated, in-memory graph bundle consumed by the traversal + resolver layers.

import type { Manifest, TimelineEvent } from "../types.ts";

export interface ArticleNode {
  kind: "article";
  id: string;
  title: string;
  categories: string[];
  eventIds: string[];
  latestEventOrder: number;
  tags: string[];
  lead: string;
  sectionIds: string[];
}

export interface SectionNode {
  kind: "section";
  id: string;
  articleId: string;
  heading: string;
  text: string;
  latestEventOrder: number;
  eventIds: string[];
  tags: string[];
}

export interface CategoryNode {
  kind: "category";
  id: string;
  name: string;
  articleIds: string[];
}

export interface LoadedGraph {
  manifest: Manifest;
  articles: Map<string, ArticleNode>;
  sections: Map<string, SectionNode>;
  categories: Map<string, CategoryNode>;
  events: Map<string, TimelineEvent>;
  edges: {
    links: Map<string, Set<string>>;
    contains: Map<string, Set<string>>;
    inCategory: Map<string, Set<string>>;
    inEvent: Map<string, Set<string>>;
    mentions: Map<string, Set<string>>;
  };
  /** normalized alias → articleId. */
  aliases: Map<string, string>;
  /** eventId → order. */
  eventOrder: Map<string, number>;
}

export interface RawNodesPayload {
  articles: ArticleNode[];
  sections: SectionNode[];
  categories: CategoryNode[];
}

export interface RawEdgesPayload {
  links: Record<string, string[]>;
  contains: Record<string, string[]>;
  inCategory: Record<string, string[]>;
  inEvent: Record<string, string[]>;
  mentions: Record<string, string[]>;
}

function objToAdjacency(obj: Record<string, string[]>): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const [k, arr] of Object.entries(obj)) {
    out.set(k, new Set(arr));
  }
  return out;
}

export function hydrateGraph(
  manifest: Manifest,
  nodes: RawNodesPayload,
  edges: RawEdgesPayload,
  aliases: Record<string, string>,
): LoadedGraph {
  const articles = new Map<string, ArticleNode>();
  for (const a of nodes.articles) articles.set(a.id, a);

  const sections = new Map<string, SectionNode>();
  for (const s of nodes.sections) sections.set(s.id, s);

  const categories = new Map<string, CategoryNode>();
  for (const c of nodes.categories) categories.set(c.id, c);

  const events = new Map<string, TimelineEvent>();
  const eventOrder = new Map<string, number>();
  for (const e of manifest.timeline.events) {
    events.set(e.id, e);
    eventOrder.set(e.id, e.order);
  }

  const aliasMap = new Map<string, string>();
  for (const [k, v] of Object.entries(aliases)) aliasMap.set(k, v);

  return {
    manifest,
    articles,
    sections,
    categories,
    events,
    edges: {
      links: objToAdjacency(edges.links),
      contains: objToAdjacency(edges.contains),
      inCategory: objToAdjacency(edges.inCategory),
      inEvent: objToAdjacency(edges.inEvent),
      mentions: objToAdjacency(edges.mentions),
    },
    aliases: aliasMap,
    eventOrder,
  };
}
