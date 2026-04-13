// packages/opensona/src/build/parse.ts
// SAX-stream parser for MediaWiki XML dumps

import { createReadStream } from "node:fs";
import sax from "sax";
import wtf from "wtf_wikipedia";

export interface ParsedSection {
  heading: string;
  text: string;
  rawText?: string;
}

export interface ParsedArticle {
  title: string;
  slug: string;
  sections: ParsedSection[];
  categories: string[];
}

/** Slugify a title: lowercase, replace non-alphanumerics with hyphens, collapse, trim */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Category prefixes/suffixes/exact names to skip during filtering */
const SKIP_CATEGORY_PREFIXES = [
  "Disambiguation",
  "Stub",
  "Real World",
  "Behind the Scenes",
  "Gameplay",
];

const TITLE_SKIP_PREFIXES = ["Quest:"];

const SKIP_CATEGORY_EXACT = new Set(["Disambiguations", "Article stubs"]);

/**
 * Returns true if the article should be dropped based on categories, title, or body length.
 */
function shouldDrop(title: string, wikitext: string, categories: string[]): boolean {
  // Skip Quest: prefix
  for (const prefix of TITLE_SKIP_PREFIXES) {
    if (title.startsWith(prefix)) return true;
  }

  // Skip by category
  for (const cat of categories) {
    if (SKIP_CATEGORY_EXACT.has(cat)) return true;
    for (const prefix of SKIP_CATEGORY_PREFIXES) {
      if (cat.startsWith(prefix)) return true;
    }
  }

  // Skip short articles (<200 chars body)
  const plainLength = wikitext.replace(/\[\[Category:[^\]]*\]\]/g, "").trim().length;
  if (plainLength < 200) return true;

  return false;
}

interface RawPage {
  title: string;
  ns: string;
  redirect: boolean;
  text: string;
}

/**
 * Parse a MediaWiki XML dump file and return an array of ParsedArticle.
 * Only namespace 0, non-redirect articles are included.
 * Articles matching skip criteria are filtered out.
 *
 * @param keepRawSections - If provided, articles whose titles are in this set
 *   will have rawText populated on each section.
 */
export async function parseDump(
  dumpPath: string,
  keepRawSections?: Set<string>,
): Promise<ParsedArticle[]> {
  const pages = await extractPages(dumpPath);
  const articles: ParsedArticle[] = [];
  const slugCounts = new Map<string, number>();

  for (const page of pages) {
    const doc = wtf(page.text);
    const categories = doc.categories() as string[];

    if (shouldDrop(page.title, page.text, categories)) continue;

    const wantRaw = keepRawSections?.has(page.title) ?? false;
    const sections = extractSections(doc, wantRaw);

    // Ensure unique slugs by appending a suffix on collision
    let slug = slugify(page.title);
    const count = slugCounts.get(slug) ?? 0;
    slugCounts.set(slug, count + 1);
    if (count > 0) {
      slug = `${slug}-${count}`;
    }

    articles.push({
      title: page.title,
      slug,
      sections,
      categories,
    });
  }

  return articles;
}

/**
 * Extract sections from a wtf_wikipedia Document.
 */
function extractSections(doc: ReturnType<typeof wtf>, wantRaw: boolean): ParsedSection[] {
  const wtfSections = doc.sections() as ReturnType<typeof wtf.prototype.sections>;
  const result: ParsedSection[] = [];

  if (!Array.isArray(wtfSections)) return result;

  for (const sec of wtfSections) {
    const heading = sec.title() || "";
    const text = sec.text({}) || "";
    const section: ParsedSection = { heading, text };

    if (wantRaw) {
      section.rawText = sec.wikitext() || "";
    }

    result.push(section);
  }

  return result;
}

/**
 * Low-level SAX extraction of pages from a MediaWiki XML dump.
 * Returns namespace-0, non-redirect pages only.
 */
function extractPages(dumpPath: string): Promise<RawPage[]> {
  return new Promise((resolve, reject) => {
    const pages: RawPage[] = [];
    const stream = createReadStream(dumpPath, { encoding: "utf-8" });
    const parser = sax.createStream(true, { trim: false });

    let inPage = false;
    let currentTag = "";
    let textBuffer = "";

    let pageTitle = "";
    let pageNs = "";
    let pageRedirect = false;
    let pageText = "";

    parser.on("opentag", (tag) => {
      const name = tag.name.toLowerCase();

      if (name === "page") {
        inPage = true;
        pageTitle = "";
        pageNs = "";
        pageRedirect = false;
        pageText = "";
      } else if (inPage && name === "redirect") {
        pageRedirect = true;
      }

      if (inPage && (name === "title" || name === "ns" || name === "text")) {
        currentTag = name;
        textBuffer = "";
      } else {
        currentTag = "";
      }
    });

    parser.on("text", (text) => {
      if (currentTag) {
        textBuffer += text;
      }
    });

    parser.on("cdata", (cdata) => {
      if (currentTag) {
        textBuffer += cdata;
      }
    });

    parser.on("closetag", (name) => {
      const tagName = name.toLowerCase();

      if (tagName === "title" && currentTag === "title") {
        pageTitle = textBuffer;
      } else if (tagName === "ns" && currentTag === "ns") {
        pageNs = textBuffer.trim();
      } else if (tagName === "text" && currentTag === "text") {
        pageText = textBuffer;
      }

      if (tagName === "title" || tagName === "ns" || tagName === "text") {
        currentTag = "";
      }

      if (tagName === "page") {
        // Only namespace 0, skip redirects
        if (pageNs === "0" && !pageRedirect) {
          pages.push({
            title: pageTitle,
            ns: pageNs,
            redirect: pageRedirect,
            text: pageText,
          });
        }
        inPage = false;
      }
    });

    parser.on("error", (err) => {
      reject(err);
    });

    parser.on("end", () => {
      resolve(pages);
    });

    stream.pipe(parser);
  });
}
