// packages/opensona/src/build/aliases.ts
// Build a normalized alias → articleId map.
//
// Pure: no fs, no network. Normalization rules intentionally aggressive so the
// resolver can match loose user phrasings (case, punctuation, spacing).

import type { ParsedArticle, Redirect } from "./parse.ts";

/** Aggressive normalization: lower-case, collapse non-alphanumerics to nothing. */
export const normalize = (s: string): string => {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
};

/** Lighter variant: lower-case, strip only punctuation; retain spacing. */
export const softNormalize = (s: string): string => {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
};

export type AliasMap = {
  /** Normalized string → article slug. */
  map: Map<string, string>;
  /** Count of redirects that couldn't be resolved to a known article. */
  unresolvedRedirects: number;
};

export const buildAliasMap = (articles: ParsedArticle[], redirects: Redirect[]): AliasMap => {
  const titleLowerToSlug = new Map<string, string>();
  for (const a of articles) {
    titleLowerToSlug.set(a.title.toLowerCase(), a.slug);
  }

  const map = new Map<string, string>();

  const setIfEmpty = (key: string, slug: string): void => {
    if (!key) return;
    if (!map.has(key)) map.set(key, slug);
  };

  // 1. Article titles themselves.
  for (const a of articles) {
    setIfEmpty(normalize(a.title), a.slug);
    setIfEmpty(softNormalize(a.title), a.slug);
    setIfEmpty(a.title.toLowerCase(), a.slug);
  }

  // 2. Redirects → their targets (which must resolve to a known article).
  let unresolvedRedirects = 0;
  for (const r of redirects) {
    const targetSlug = titleLowerToSlug.get(r.to.toLowerCase());
    if (!targetSlug) {
      unresolvedRedirects++;
      continue;
    }
    setIfEmpty(normalize(r.from), targetSlug);
    setIfEmpty(softNormalize(r.from), targetSlug);
    setIfEmpty(r.from.toLowerCase(), targetSlug);
  }

  // 3. Infobox `name` / `aliases` fields when present.
  for (const a of articles) {
    for (const key of ["name", "aliases", "fullname", "realname", "handle"]) {
      const raw = a.infobox[key];
      if (!raw) continue;
      for (const piece of splitInfoboxList(raw)) {
        setIfEmpty(normalize(piece), a.slug);
        setIfEmpty(softNormalize(piece), a.slug);
      }
    }
  }

  return { map, unresolvedRedirects };
};

/** Infobox list fields are often comma/semicolon/bullet separated. */
function splitInfoboxList(raw: string): string[] {
  return raw
    .split(/[,;•\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Resolve a user/LLM-supplied string to an article id using the alias map.
 * Tries the most permissive normalization last.
 */
export const resolveAlias = (raw: string, aliases: Map<string, string>): string | null => {
  const lower = raw.toLowerCase();
  return (
    aliases.get(lower) ?? aliases.get(softNormalize(raw)) ?? aliases.get(normalize(raw)) ?? null
  );
};
