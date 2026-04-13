// packages/opensona/src/build/timeline.ts
// Generate a Timeline from the wiki's "Timeline" article

import type { OpensonaConfig, Timeline, TimelineEvent } from "../types.ts";
import type { ParsedArticle } from "./parse.ts";
import { slugify } from "./parse.ts";

/**
 * Extract all [[wiki links]] from raw wikitext, returning the page names.
 */
const extractWikiLinks = (raw: string): string[] => {
  const links: string[] = [];
  const re = /\[\[([^\]|#]+)(?:[|#][^\]]*)?]]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw)) !== null) {
    const page = match[1].trim();
    if (page && !page.startsWith("File:") && !page.startsWith("Category:")) {
      links.push(page);
    }
  }
  return links;
};

/**
 * Try to parse an explicit date from a bullet line.
 * Looks for patterns like '''Month Day''': or '''Month''':
 * Returns the day-of-year (1-366) for ordering, or null if no date found.
 */
const parseExplicitDate = (raw: string): number | null => {
  // Match '''Month Day''' or '''Month'''
  const dateRe = /'''([A-Z][a-z]+)(?:\s+(\d{1,2}))?'''/;
  const m = dateRe.exec(raw);
  if (!m) return null;

  const monthStr = m[1];
  const dayStr = m[2];

  const months: Record<string, number> = {
    January: 0,
    February: 1,
    March: 2,
    April: 3,
    May: 4,
    June: 5,
    July: 6,
    August: 7,
    September: 8,
    October: 9,
    November: 10,
    December: 11,
  };

  const monthIdx = months[monthStr];
  if (monthIdx === undefined) return null;

  const day = dayStr ? parseInt(dayStr, 10) : 1;
  // Convert to a rough day-of-year for ordering
  const daysPerMonth = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  return daysPerMonth[monthIdx] + day;
};

/**
 * Strip wiki markup from text to produce a clean event name.
 */
const stripMarkup = (text: string): string => {
  return (
    text
      // Remove bold/italic markers
      .replace(/'{2,5}/g, "")
      // Remove [[link|display]] -> display, [[link]] -> link
      .replace(/\[\[([^\]|]*)\|([^\]]*)]]/g, "$2")
      .replace(/\[\[([^\]]*)]]/g, "$1")
      // Remove <ref>...</ref> and <ref ... />
      .replace(/<ref[^>]*\/>/gi, "")
      .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, "")
      // Remove HTML tags
      .replace(/<[^>]+>/g, "")
      // Clean up whitespace
      .replace(/\s+/g, " ")
      .trim()
  );
};

/**
 * Determine if a heading looks like a year heading (e.g. "2013", "2077").
 */
const isYearHeading = (heading: string): boolean => {
  return /^\d{3,4}$/.test(heading.trim());
};

/**
 * Parse the timeline article and generate a Timeline.
 * Requires that the ParsedArticle has rawText on its sections.
 */
export const generateTimeline = (
  timelineArticle: ParsedArticle,
  config: OpensonaConfig,
): Timeline => {
  const events: TimelineEvent[] = [];

  // We need raw section text for link and date extraction.
  // The algorithm: walk sections looking for year headings.
  // Decade headings (== 2010s ==) contain year headings (=== 2013 ===).
  // Each bullet under a year heading becomes an event.

  let yearHeadingsFound = 0;

  for (const section of timelineArticle.sections) {
    const heading = section.heading.trim();

    // We only care about year sections
    if (!isYearHeading(heading)) continue;

    yearHeadingsFound++;
    const year = parseInt(heading, 10);
    const rawText = section.rawText ?? "";

    // Extract bullet lines from raw wikitext
    const bulletLines = rawText.split("\n").filter((line) => line.match(/^\*/));

    let bulletIndex = 0;
    for (const bullet of bulletLines) {
      const cleanBullet = bullet.replace(/^\*\s*/, "");
      if (!cleanBullet.trim()) continue;

      // Parse explicit date for sub-ordering
      const dateDayOfYear = parseExplicitDate(cleanBullet);
      const baseOrder = year * 100;
      let order: number;
      if (dateDayOfYear !== null) {
        // Scale day-of-year (1-366) into sub-order range (1-99)
        // This gives ~0.27 per day, enough to distinguish months
        order = baseOrder + Math.min(Math.round(dateDayOfYear / 3.66), 99);
      } else {
        // Sequential sub-ordering by bullet position, starting from 1
        order = baseOrder + bulletIndex + 1;
      }

      const keywords = extractWikiLinks(cleanBullet);

      // Generate event name: stripped markup, truncated to ~80 chars
      const fullName = stripMarkup(cleanBullet);
      const name = fullName.length > 80 ? fullName.slice(0, 77) + "..." : fullName;

      // Generate event ID: slugify first ~60 chars of name, suffix with year
      // to disambiguate identical bullet names that recur across years
      // (e.g., "Most adventures in the series take place" appears in 2013, 2020, 2045).
      const idSource = fullName.slice(0, 60);
      const idSlug = slugify(idSource);

      if (idSlug) {
        events.push({
          id: `${idSlug}-${year}`,
          name,
          year,
          order,
          ...(keywords.length > 0 ? { keywords } : {}),
        });
      }

      bulletIndex++;
    }
  }

  const { minYearHeadings, minEvents } = config.timelineValidation;

  if (yearHeadingsFound < minYearHeadings) {
    throw new Error(
      `Timeline article has ${yearHeadingsFound} year headings (expected at least ${minYearHeadings}). ` +
        "Expected sections like '=== 2013 ===' under decade headings. " +
        "The wiki timeline article structure may have changed.",
    );
  }

  if (events.length < minEvents) {
    throw new Error(
      `Timeline generated only ${events.length} events (expected at least ${minEvents}). ` +
        "The wiki timeline article structure may have changed.",
    );
  }

  // Sort by order for consistency
  events.sort((a, b) => a.order - b.order);

  return { events };
};
