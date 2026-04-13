// packages/opensona/src/build/prebuild-categories.ts
// Map wiki categories to timeline event IDs by edition/era

import type { OpensonaConfig, Timeline } from "../types.ts";
import type { ParsedArticle } from "./parse.ts";

export type CategoryEventMap = {
  mapping: Record<string, string>; // category -> eventId
  skipped: string[]; // categories that were skipped
};

function shouldSkipCategory(category: string, skip: OpensonaConfig["categorySkip"]): boolean {
  if (skip.exact.includes(category)) return true;

  for (const prefix of skip.prefixes) {
    if (category.startsWith(prefix)) return true;
  }

  const lower = category.toLowerCase();
  for (const suffix of skip.suffixes) {
    if (lower.endsWith(suffix)) return true;
  }

  return false;
}

function findFirstEventInRange(
  timeline: Timeline,
  startYear: number,
  endYear: number,
): string | null {
  for (const event of timeline.events) {
    if (event.year >= startYear && event.year <= endYear) {
      return event.id;
    }
  }
  return null;
}

function matchCategoryToEvent(
  category: string,
  timeline: Timeline,
  editionEras: OpensonaConfig["editionEras"],
): string | null {
  for (const era of editionEras) {
    if (category.startsWith(era.prefix)) {
      return findFirstEventInRange(timeline, era.startYear, era.endYear);
    }
  }
  return null;
}

/**
 * Generate a mapping from categories to timeline event IDs.
 * Edition-era prefixes and skip rules come from config.
 */
export function generateCategoryEventMap(
  articles: ParsedArticle[],
  timeline: Timeline,
  config: OpensonaConfig,
): CategoryEventMap {
  const allCategories = new Set<string>();
  for (const article of articles) {
    for (const cat of article.categories) {
      allCategories.add(cat);
    }
  }

  const mapping: Record<string, string> = {};
  const skipped: string[] = [];

  for (const category of [...allCategories].sort()) {
    if (shouldSkipCategory(category, config.categorySkip)) {
      skipped.push(category);
      continue;
    }

    const eventId = matchCategoryToEvent(category, timeline, config.editionEras);
    if (eventId) {
      mapping[category] = eventId;
    }
  }

  return { mapping, skipped };
}
