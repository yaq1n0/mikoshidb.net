// packages/opensona/src/runtime/resolve.ts
// Resolver helpers. Opensona owns the prompt template + directive schema but
// never calls an LLM — callers wire the round-trip via `getTraversalPath`.

import type { EntityVocab, ResolverInput, TraversalDirective } from "../types.ts";
import { normalize, softNormalize } from "../build/aliases.ts";
import type { LoadedGraph } from "./graph.ts";

export type ResolverMessage = { role: "system" | "user"; content: string };

const SYSTEM_PROMPT = `You are a retrieval planner for a lore database. Given a user query, a persona's context, and an entity vocabulary, decide which entities to pull from a knowledge graph.

Return strictly valid JSON with this shape and no surrounding prose:
{
  "entities": string[],
  "neighbors": "none" | "direct" | "two_hop",
  "include_categories": string[],
  "reasoning": string
}

Rules:
- "entities" MUST be a subset of the provided names list. Echo the names verbatim.
- Use "none" when the query is a direct look-up of a single well-named entity.
- Use "direct" when the query asks about an entity's relationships or attributes.
- Use "two_hop" only for relational queries across two entities (e.g. "how does X know Y").
- "include_categories" MUST be a subset of the provided categories list. Keep it empty unless the query explicitly asks about a class of things.
- Return an empty entities array if the query has no clear anchor in the vocabulary — do not guess.
- Keep reasoning under 40 words.`;

/** Formats user. */
const formatUser = (input: ResolverInput): string => {
  const { userQuery, characterContext, entityVocab } = input;
  const namesBlock = entityVocab.names.join(", ");
  const catsBlock = entityVocab.categories.join(", ");
  return [
    `Persona: ${characterContext.id}`,
    `Persona bio: ${characterContext.bio}`,
    "",
    `Known names:\n${namesBlock}`,
    "",
    `Known categories:\n${catsBlock}`,
    "",
    `User query: ${userQuery}`,
    "",
    "Respond with the JSON directive only.",
  ].join("\n");
};

/** Build the resolver message list. Callers hand these to their LLM of choice. */
export const buildResolverMessages = (input: ResolverInput): ResolverMessage[] => {
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: formatUser(input) },
  ];
};

/**
 * Parse + validate raw LLM output into a {@link TraversalDirective}.
 *
 * Tolerant of surrounding prose: extracts the first `{...}` JSON block. Returns
 * `null` on any parse or shape failure so callers can decide what to do next.
 */
export const parseTraversalDirective = (raw: string): TraversalDirective | null => {
  if (!raw) return null;
  const text = raw.trim();
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) return null;
  const body = text.slice(firstBrace, lastBrace + 1);

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;

  const entities = Array.isArray(obj.entities)
    ? obj.entities.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    : [];

  const neighborsRaw = typeof obj.neighbors === "string" ? obj.neighbors : "none";
  const neighbors: "none" | "direct" | "two_hop" =
    neighborsRaw === "direct" || neighborsRaw === "two_hop" ? neighborsRaw : "none";

  const includeCategories = Array.isArray(obj.include_categories)
    ? obj.include_categories.filter((x): x is string => typeof x === "string" && x.length > 0)
    : [];

  const reasoning = typeof obj.reasoning === "string" ? obj.reasoning : undefined;

  return {
    entities,
    neighbors,
    include_categories: includeCategories,
    ...(reasoning !== undefined ? { reasoning } : {}),
  };
};

const VOCAB_NAME_LIMIT = 150;
const VOCAB_CATEGORY_LIMIT = 40;

/**
 * Compute an {@link EntityVocab} for an engram: its article title plus the
 * titles of its 1-hop link neighbors, bounded so the resolver prompt stays
 * compact.
 *
 * Exposed so callers can pre-warm the vocab on character switch; the runtime
 * calls it internally on first query.
 */
export const warmEngram = (engramId: string, graph: LoadedGraph): EntityVocab => {
  const article = graph.articles.get(engramId);
  if (!article) {
    return { engramId, names: [], categories: [] };
  }

  const names: string[] = [article.title];
  const seenTitles = new Set<string>([article.title]);

  const neighbors = graph.edges.links.get(engramId);
  if (neighbors) {
    for (const n of neighbors) {
      if (names.length >= VOCAB_NAME_LIMIT) break;
      const neighbor = graph.articles.get(n);
      if (!neighbor) continue;
      if (seenTitles.has(neighbor.title)) continue;
      seenTitles.add(neighbor.title);
      names.push(neighbor.title);
    }
  }

  const seenCats = new Set<string>();
  const categories: string[] = [];
  const scan = (articleId: string): void => {
    const art = graph.articles.get(articleId);
    if (!art) return;
    for (const c of art.categories) {
      if (seenCats.has(c)) continue;
      seenCats.add(c);
      categories.push(c);
      if (categories.length >= VOCAB_CATEGORY_LIMIT) return;
    }
  };
  scan(engramId);
  if (neighbors) {
    for (const n of neighbors) {
      if (categories.length >= VOCAB_CATEGORY_LIMIT) break;
      scan(n);
    }
  }

  return { engramId, names, categories };
};

/** Normalized alias lookup. Exported for debug/introspection parity with build. */
export { normalize as normalizeAlias, softNormalize as softNormalizeAlias };
