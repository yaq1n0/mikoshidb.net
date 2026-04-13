// packages/opensona/src/build/parse.ts
// SAX-stream parser for MediaWiki XML dumps.
//
// Returns both `articles` (namespace-0, non-redirect, non-skipped pages)
// and `redirects` (title → target) so the graph builder can wire aliases
// from redirect pages that would otherwise be discarded.

import { createReadStream } from "node:fs";
import sax from "sax";
import wtf from "wtf_wikipedia";

export type ParsedSection = {
  heading: string;
  text: string;
  rawText?: string;
  /** Plain wiki link targets (de-anchored, de-piped) found in this section. */
  links: string[];
};

export type ParsedArticle = {
  title: string;
  slug: string;
  sections: ParsedSection[];
  categories: string[];
  /** All wiki link targets in the article body. */
  links: string[];
  /** Infobox fields (name, aliases, etc.), flattened to plain strings. */
  infobox: Record<string, string>;
};

export type Redirect = {
  from: string;
  to: string;
};

export type ParseResult = {
  articles: ParsedArticle[];
  redirects: Redirect[];
};

/** Slugify a title: lowercase, replace non-alphanumerics with hyphens, collapse, trim */
export const slugify = (text: string): string => {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
};

const SKIP_CATEGORY_PREFIXES = [
  "Disambiguation",
  "Stub",
  "Real World",
  "Behind the Scenes",
  "Gameplay",
];

const TITLE_SKIP_PREFIXES = ["Quest:"];

const SKIP_CATEGORY_EXACT = new Set(["Disambiguations", "Article stubs"]);

/** True if drop. */
const shouldDrop = (title: string, wikitext: string, categories: string[]): boolean => {
  for (const prefix of TITLE_SKIP_PREFIXES) {
    if (title.startsWith(prefix)) return true;
  }

  for (const cat of categories) {
    if (SKIP_CATEGORY_EXACT.has(cat)) return true;
    for (const prefix of SKIP_CATEGORY_PREFIXES) {
      if (cat.startsWith(prefix)) return true;
    }
  }

  const plainLength = wikitext.replace(/\[\[Category:[^\]]*\]\]/g, "").trim().length;
  if (plainLength < 200) return true;

  return false;
};

type RawPage = {
  title: string;
  ns: string;
  redirect: boolean;
  redirectTarget: string | null;
  text: string;
};

/**
 * Parse a MediaWiki XML dump file.
 *
 * Articles returned: namespace 0, non-redirect, not filtered by `shouldDrop`.
 * Redirects returned: every namespace-0 redirect page with a resolved target.
 */
export const parseDump = async (
  dumpPath: string,
  keepRawSections?: Set<string>,
): Promise<ParseResult> => {
  const pages = await extractPages(dumpPath);
  const articles: ParsedArticle[] = [];
  const redirects: Redirect[] = [];
  const slugCounts = new Map<string, number>();

  for (const page of pages) {
    if (page.redirect) {
      if (page.redirectTarget) {
        redirects.push({ from: page.title, to: page.redirectTarget });
      }
      continue;
    }

    const doc = wtf(page.text);
    const categories = doc.categories() as string[];

    if (shouldDrop(page.title, page.text, categories)) continue;

    const wantRaw = keepRawSections?.has(page.title) ?? false;
    const sections = extractSections(doc, wantRaw);
    const links = extractDocLinks(doc);
    const infobox = extractInfobox(doc);

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
      links,
      infobox,
    });
  }

  return { articles, redirects };
};

/** wtf_wikipedia's shape is loose; narrow at the call site. */
type WtfDoc = ReturnType<typeof wtf>;
type WtfSection = ReturnType<WtfDoc["sections"]>[number];

/** Extracts sections. */
function extractSections(doc: WtfDoc, wantRaw: boolean): ParsedSection[] {
  const wtfSections = doc.sections() as WtfSection[];
  const result: ParsedSection[] = [];

  if (!Array.isArray(wtfSections)) return result;

  for (const sec of wtfSections) {
    const heading = sec.title() || "";
    const text = sec.text({}) || "";
    const links = extractSectionLinks(sec);
    const section: ParsedSection = { heading, text, links };

    if (wantRaw) {
      section.rawText = sec.wikitext() || "";
    }

    result.push(section);
  }

  return result;
}

type WtfLinkLike = {
  page?: () => string | undefined;
  text?: () => string | undefined;
};

/** Extracts doc links. */
function extractDocLinks(doc: WtfDoc): string[] {
  const raw = (doc as unknown as { links: () => WtfLinkLike[] }).links?.() ?? [];
  return normalizeLinkList(raw);
}

/** Extracts section links. */
function extractSectionLinks(sec: WtfSection): string[] {
  const raw = (sec as unknown as { links?: () => WtfLinkLike[] }).links?.() ?? [];
  return normalizeLinkList(raw);
}

/** Normalizes link list. */
function normalizeLinkList(raw: WtfLinkLike[]): string[] {
  const out = new Set<string>();
  for (const l of raw) {
    const page = typeof l.page === "function" ? l.page() : undefined;
    if (page && typeof page === "string") {
      const trimmed = page.trim();
      if (trimmed) out.add(trimmed);
    }
  }
  return [...out];
}

/** Extracts infobox. */
function extractInfobox(doc: WtfDoc): Record<string, string> {
  const ib = (doc as unknown as { infobox?: () => unknown }).infobox?.();
  if (!ib || typeof ib !== "object") return {};
  const json = (ib as { json?: () => Record<string, unknown> }).json?.();
  if (!json || typeof json !== "object") return {};

  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(json)) {
    if (v == null) continue;
    if (typeof v === "string") {
      out[k] = v;
    } else if (typeof v === "object" && "text" in (v as object)) {
      const text = (v as { text?: unknown }).text;
      if (typeof text === "string") out[k] = text;
    }
  }
  return out;
}

/**
 * Low-level SAX extraction of pages from a MediaWiki XML dump.
 * Returns all namespace-0 pages (both articles and redirects).
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
    let pageRedirectTarget: string | null = null;
    let pageText = "";

    parser.on("opentag", (tag) => {
      const name = tag.name.toLowerCase();

      if (name === "page") {
        inPage = true;
        pageTitle = "";
        pageNs = "";
        pageRedirect = false;
        pageRedirectTarget = null;
        pageText = "";
      } else if (inPage && name === "redirect") {
        pageRedirect = true;
        const attrs = tag.attributes as Record<string, string> | undefined;
        const t = attrs?.title ?? attrs?.TITLE;
        if (typeof t === "string" && t.trim()) {
          pageRedirectTarget = t.trim();
        }
      }

      if (inPage && (name === "title" || name === "ns" || name === "text")) {
        currentTag = name;
        textBuffer = "";
      } else {
        currentTag = "";
      }
    });

    parser.on("text", (text) => {
      if (currentTag) textBuffer += text;
    });

    parser.on("cdata", (cdata) => {
      if (currentTag) textBuffer += cdata;
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
        if (pageNs === "0") {
          pages.push({
            title: pageTitle,
            ns: pageNs,
            redirect: pageRedirect,
            redirectTarget: pageRedirectTarget,
            text: pageText,
          });
        }
        inPage = false;
      }
    });

    parser.on("error", (err) => reject(err));
    parser.on("end", () => resolve(pages));

    stream.pipe(parser);
  });
}
