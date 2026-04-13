// packages/opensona/src/build/graph.ts
// Build a knowledge graph from parsed articles + timeline + category map.

import type { OpensonaConfig, Timeline, TimelineEvent } from "../types.ts";
import type { ParsedArticle, Redirect } from "./parse.ts";
import { slugify } from "./parse.ts";
import { buildAliasMap, resolveAlias } from "./aliases.ts";
import type { CategoryEventMap } from "./prebuild-categories.ts";

export type ArticleNode = {
  kind: "article";
  id: string;
  title: string;
  categories: string[];
  eventIds: string[];
  /** `-1` means timeless. */
  latestEventOrder: number;
  tags: string[];
  lead: string;
  sectionIds: string[];
};

export type SectionNode = {
  kind: "section";
  id: string;
  articleId: string;
  heading: string;
  text: string;
  /** `-1` means timeless. */
  latestEventOrder: number;
  eventIds: string[];
  tags: string[];
};

export type CategoryNode = {
  kind: "category";
  id: string;
  name: string;
  articleIds: string[];
};

export type GraphArtifact = {
  nodes: {
    articles: Map<string, ArticleNode>;
    sections: Map<string, SectionNode>;
    categories: Map<string, CategoryNode>;
    events: Map<string, TimelineEvent>;
  };
  edges: {
    /** article → article (resolved wiki links). */
    links: Map<string, Set<string>>;
    /** article → section. */
    contains: Map<string, Set<string>>;
    /** article → category. */
    inCategory: Map<string, Set<string>>;
    /** article | section → timelineEvent. */
    inEvent: Map<string, Set<string>>;
    /** section → article (optional; gated by config). */
    mentions: Map<string, Set<string>>;
  };
  aliases: Map<string, string>;
  deadLinkCount: number;
};

/**
 * Parse explicit 4-digit years from a section heading. Decade suffixes like
 * "2010s" resolve to the decade-start year. Returns the LATEST year mentioned
 * (a section is knowable from the latest point it describes) or `null` if none.
 *
 * Ported from the legacy chunk.ts pipeline.
 */
export function parseSectionYear(heading: string): number | null {
  const re = /\b(19|20)(\d{2})s?\b/g;
  const years: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(heading)) !== null) {
    years.push(parseInt(m[1] + m[2], 10));
  }
  if (years.length === 0) return null;
  return Math.max(...years);
}

function addEdge(map: Map<string, Set<string>>, src: string, dst: string): void {
  let set = map.get(src);
  if (!set) {
    set = new Set();
    map.set(src, set);
  }
  set.add(dst);
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  // Try to end at a sentence boundary within maxChars.
  const slice = text.slice(0, maxChars);
  const lastStop = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("\n"));
  if (lastStop > maxChars * 0.6) {
    return slice.slice(0, lastStop + 1).trim();
  }
  return slice.trim();
}

export function buildGraph(
  articles: ParsedArticle[],
  redirects: Redirect[],
  timeline: Timeline,
  categoryMap: CategoryEventMap,
  config: OpensonaConfig,
): GraphArtifact {
  const eventOrderMap = new Map<string, number>();
  for (const e of timeline.events) eventOrderMap.set(e.id, e.order);

  const { map: aliases } = buildAliasMap(articles, redirects);

  const titleToSlug = new Map<string, string>();
  for (const a of articles) titleToSlug.set(a.title, a.slug);

  const resolveLinkTarget = (raw: string): string | null => {
    // Wiki links may include section anchors like "Page#Section"; grain is article.
    const bare = raw.split("#")[0].trim();
    if (!bare) return null;
    const direct = titleToSlug.get(bare);
    if (direct) return direct;
    return resolveAlias(bare, aliases);
  };

  const articleNodes = new Map<string, ArticleNode>();
  const sectionNodes = new Map<string, SectionNode>();
  const categoryNodes = new Map<string, CategoryNode>();
  const eventNodes = new Map<string, TimelineEvent>();
  for (const e of timeline.events) eventNodes.set(e.id, e);

  const linkEdges = new Map<string, Set<string>>();
  const containsEdges = new Map<string, Set<string>>();
  const inCategoryEdges = new Map<string, Set<string>>();
  const inEventEdges = new Map<string, Set<string>>();
  const mentionsEdges = new Map<string, Set<string>>();

  let deadLinkCount = 0;

  // Pass 1: articles + sections + category memberships + event memberships.
  for (const a of articles) {
    // Category-derived event anchors.
    const categoryEventIds = new Set<string>();
    for (const c of a.categories) {
      const eid = categoryMap.mapping[c];
      if (eid) categoryEventIds.add(eid);
    }

    let articleFloor = -1;
    if (categoryEventIds.size > 0) {
      let minOrder = Infinity;
      for (const eid of categoryEventIds) {
        const ord = eventOrderMap.get(eid);
        if (ord !== undefined && ord < minOrder) minOrder = ord;
      }
      if (minOrder !== Infinity) articleFloor = minOrder;
    }

    const tags = a.categories.map((c) => slugify(c)).filter(Boolean);

    // Lead: first section's text if any, else nothing.
    const firstSectionText = a.sections[0]?.text ?? "";
    const lead = truncate(firstSectionText, config.graph.leadMaxChars);

    const sectionIds: string[] = [];
    let articleLatest = articleFloor;

    // Sections pass.
    a.sections.forEach((sec, i) => {
      const sectionId = `${a.slug}#${i}`;
      sectionIds.push(sectionId);

      const sectionYear = parseSectionYear(sec.heading);
      const sectionFloor = sectionYear !== null ? sectionYear * 100 + 1 : -1;
      const sectionLatest = Math.max(articleFloor, sectionFloor);
      if (sectionLatest > articleLatest) articleLatest = sectionLatest;

      const text = truncate(sec.text, config.graph.sectionMaxChars);

      const sectionEventIds = [...categoryEventIds];
      const node: SectionNode = {
        kind: "section",
        id: sectionId,
        articleId: a.slug,
        heading: sec.heading,
        text,
        latestEventOrder: sectionLatest,
        eventIds: sectionEventIds,
        tags,
      };
      sectionNodes.set(sectionId, node);

      addEdge(containsEdges, a.slug, sectionId);

      for (const eid of sectionEventIds) {
        if (eventNodes.has(eid)) addEdge(inEventEdges, sectionId, eid);
      }

      if (config.graph.includeMentionsEdges) {
        for (const link of sec.links) {
          const targetSlug = resolveLinkTarget(link);
          if (targetSlug && targetSlug !== a.slug) {
            addEdge(mentionsEdges, sectionId, targetSlug);
          }
        }
      }
    });

    const articleNode: ArticleNode = {
      kind: "article",
      id: a.slug,
      title: a.title,
      categories: a.categories,
      eventIds: [...categoryEventIds],
      latestEventOrder: articleLatest,
      tags,
      lead,
      sectionIds,
    };
    articleNodes.set(a.slug, articleNode);

    for (const eid of categoryEventIds) {
      if (eventNodes.has(eid)) addEdge(inEventEdges, a.slug, eid);
    }

    for (const cat of a.categories) {
      const catId = slugify(cat);
      if (!catId) continue;
      let cnode = categoryNodes.get(catId);
      if (!cnode) {
        cnode = { kind: "category", id: catId, name: cat, articleIds: [] };
        categoryNodes.set(catId, cnode);
      }
      cnode.articleIds.push(a.slug);
      addEdge(inCategoryEdges, a.slug, catId);
    }
  }

  // Pass 2: article-to-article link edges (needs all articles registered first).
  for (const a of articles) {
    for (const link of a.links) {
      const targetSlug = resolveLinkTarget(link);
      if (!targetSlug) {
        if (config.graph.dropDeadLinks) {
          deadLinkCount++;
        }
        continue;
      }
      if (targetSlug === a.slug) continue;
      addEdge(linkEdges, a.slug, targetSlug);
    }
  }

  return {
    nodes: {
      articles: articleNodes,
      sections: sectionNodes,
      categories: categoryNodes,
      events: eventNodes,
    },
    edges: {
      links: linkEdges,
      contains: containsEdges,
      inCategory: inCategoryEdges,
      inEvent: inEventEdges,
      mentions: mentionsEdges,
    },
    aliases,
    deadLinkCount,
  };
}

/** Total edge count across all types — stamped into the manifest. */
export function countEdges(edges: GraphArtifact["edges"]): number {
  let n = 0;
  for (const m of Object.values(edges)) {
    for (const set of m.values()) n += set.size;
  }
  return n;
}
