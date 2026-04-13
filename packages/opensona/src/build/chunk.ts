// packages/opensona/src/build/chunk.ts
// Chunk parsed articles into ~350-token pieces with event tagging

import type { Chunk, OpensonaConfig, Timeline } from "../types.ts";
import type { ParsedArticle } from "./parse.ts";
import { slugify } from "./parse.ts";

export interface ChunkingContext {
  categoryEventMap: Record<string, string>; // category -> eventId
  timeline: Timeline;
  titleEventOverrides?: Record<string, string[]>; // articleTitle -> eventIds
}

/**
 * Find the last sentence boundary (. ! ? followed by space or EOL)
 * at or before the given character index. Returns the index after
 * the sentence-ending punctuation, or -1 if none found.
 */
function lastSentenceBoundary(text: string, maxIndex: number): number {
  let best = -1;
  for (let i = 0; i <= maxIndex && i < text.length; i++) {
    const ch = text[i];
    if (ch === "." || ch === "!" || ch === "?") {
      // Must be followed by space, newline, or be at end of text
      const next = i + 1;
      if (next >= text.length || text[next] === " " || text[next] === "\n") {
        best = next;
      }
    }
  }
  return best;
}

/**
 * Split text into chunks of approximately targetTokens tokens,
 * with overlap of overlapTokens. Never splits mid-sentence.
 */
export function splitIntoChunks(
  text: string,
  targetTokens: number,
  maxTokens: number,
  overlapTokens: number,
): string[] {
  if (!text.trim()) return [];

  const targetChars = targetTokens * 4;
  const maxChars = maxTokens * 4;
  const overlapChars = overlapTokens * 4;

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    const remaining = text.length - start;

    // If remaining text fits in max, take it all
    if (remaining <= maxChars) {
      const piece = text.slice(start).trim();
      if (piece) chunks.push(piece);
      break;
    }

    // Try to split at sentence boundary near targetChars
    let boundary = lastSentenceBoundary(text, start + targetChars);

    // If no boundary found before target, look up to maxChars
    if (boundary <= start) {
      boundary = lastSentenceBoundary(text, start + maxChars);
    }

    // If still no boundary, force split at targetChars
    if (boundary <= start) {
      boundary = start + targetChars;
    }

    const piece = text.slice(start, boundary).trim();
    if (piece) chunks.push(piece);

    // Next chunk starts overlapChars before the boundary
    const nextStart = boundary - overlapChars;
    start = nextStart > start ? nextStart : boundary;
  }

  return chunks;
}

/**
 * Parse explicit 4-digit years from a section heading (e.g. "2076",
 * "2020 - 2023", "Early life - 2010s"). Decade suffixes like "2010s"
 * resolve to the decade-start year (2010). Returns the LATEST year
 * mentioned — a section is knowable from the latest point it describes.
 * Returns null if no year is found.
 */
function parseSectionYear(heading: string): number | null {
  const re = /\b(19|20)(\d{2})s?\b/g;
  const years: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(heading)) !== null) {
    years.push(parseInt(m[1] + m[2], 10));
  }
  if (years.length === 0) return null;
  return Math.max(...years);
}

/**
 * Chunk articles into ~350 token pieces with event tagging.
 *
 * `latestEventOrder` semantics: the earliest timeline order at which
 * a reader could reasonably know this chunk's content. Computed as:
 *   max(
 *     MIN of category anchor orders (earliest era the subject exists in),
 *     section-heading year floor (if the heading declares a time period),
 *     MAX of title-override orders (explicit per-article anchors),
 *   )
 * If no signal applies, the chunk is timeless (-1).
 */
export function chunkArticles(
  articles: ParsedArticle[],
  ctx: ChunkingContext,
  config: OpensonaConfig,
): Chunk[] {
  const allChunks: Chunk[] = [];

  // Build a lookup for event orders by ID
  const eventOrderMap = new Map<string, number>();
  for (const event of ctx.timeline.events) {
    eventOrderMap.set(event.id, event.order);
  }

  for (const article of articles) {
    let chunkIndex = 0;

    // Determine event IDs from categories
    const categoryEventIds = new Set<string>();
    for (const cat of article.categories) {
      const eventId = ctx.categoryEventMap[cat];
      if (eventId) categoryEventIds.add(eventId);
    }

    // Article floor: earliest era the subject appears in
    let articleFloorOrder = -1;
    if (categoryEventIds.size > 0) {
      let minOrder = Infinity;
      for (const eid of categoryEventIds) {
        const order = eventOrderMap.get(eid);
        if (order !== undefined && order < minOrder) minOrder = order;
      }
      if (minOrder !== Infinity) articleFloorOrder = minOrder;
    }

    // Title override IDs and their floor (explicit later anchors)
    const overrideIds = new Set<string>();
    let overrideFloor = -1;
    if (ctx.titleEventOverrides) {
      const overrides = ctx.titleEventOverrides[article.title];
      if (overrides) {
        for (const eid of overrides) {
          overrideIds.add(eid);
          const order = eventOrderMap.get(eid);
          if (order !== undefined && order > overrideFloor) overrideFloor = order;
        }
      }
    }

    // Tags from categories
    const tags = article.categories.map((c) => slugify(c)).filter(Boolean);

    for (const section of article.sections) {
      const header =
        section.heading && section.heading.trim()
          ? `[${article.title} > ${section.heading}]`
          : `[${article.title}]`;

      // Section-heading year floor (e.g. "2076" -> 207601)
      const sectionYear = parseSectionYear(section.heading);
      const sectionFloor = sectionYear !== null ? sectionYear * 100 + 1 : -1;

      const { targetTokens, maxTokens, overlapTokens } = config.chunking;
      const textChunks = splitIntoChunks(section.text, targetTokens, maxTokens, overlapTokens);

      for (const chunkText of textChunks) {
        // Event tagging: categories + title overrides. No keyword scan —
        // substring matches on short generic keywords ("AI", "Arasaka")
        // over-tagged nearly every chunk with late-timeline events.
        const eventIds = new Set<string>(categoryEventIds);
        for (const eid of overrideIds) eventIds.add(eid);

        const latestEventOrder = Math.max(articleFloorOrder, sectionFloor, overrideFloor);

        const chunk: Chunk = {
          id: `${article.slug}#${chunkIndex}`,
          articleId: article.slug,
          title: article.title,
          header,
          text: chunkText,
          eventIds: [...eventIds],
          latestEventOrder,
          tags,
          categories: article.categories,
        };

        allChunks.push(chunk);
        chunkIndex++;
      }
    }
  }

  return allChunks;
}
