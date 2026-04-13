import { describe, it, expect } from "vitest";
import type { Manifest } from "../types.ts";
import type { LoadedGraph, ArticleNode } from "./graph.ts";
import { buildResolverMessages, parseTraversalDirective, warmEngram } from "./resolve.ts";

describe("parseTraversalDirective()", () => {
  it("extracts JSON from surrounding prose", () => {
    const out = parseTraversalDirective(
      'foo bar {"entities":["V"],"neighbors":"direct","include_categories":[]} trailing',
    );
    expect(out).toEqual({ entities: ["V"], neighbors: "direct", include_categories: [] });
  });

  it("returns null for empty input", () => {
    expect(parseTraversalDirective("")).toBeNull();
  });

  it("returns null when no braces are present", () => {
    expect(parseTraversalDirective("no braces here")).toBeNull();
  });

  it("returns null for invalid JSON inside the brace block", () => {
    expect(parseTraversalDirective("{not: valid}")).toBeNull();
  });

  it("coerces non-array entities to empty array", () => {
    const out = parseTraversalDirective(
      '{"entities":"V","neighbors":"none","include_categories":[]}',
    );
    expect(out!.entities).toEqual([]);
  });

  it("filters non-string and blank entries in entities", () => {
    const out = parseTraversalDirective(
      '{"entities":["V","",123,"  ","Johnny"],"neighbors":"direct","include_categories":[]}',
    );
    expect(out!.entities).toEqual(["V", "Johnny"]);
  });

  it("falls back neighbors to 'none' for unrecognized values", () => {
    const out = parseTraversalDirective(
      '{"entities":[],"neighbors":"five_hop","include_categories":[]}',
    );
    expect(out!.neighbors).toBe("none");
  });

  it("preserves 'direct' and 'two_hop' neighbors", () => {
    const d = parseTraversalDirective(
      '{"entities":[],"neighbors":"direct","include_categories":[]}',
    );
    const t = parseTraversalDirective(
      '{"entities":[],"neighbors":"two_hop","include_categories":[]}',
    );
    expect(d!.neighbors).toBe("direct");
    expect(t!.neighbors).toBe("two_hop");
  });

  it("filters include_categories to non-empty strings", () => {
    const out = parseTraversalDirective(
      '{"entities":[],"neighbors":"none","include_categories":["", "X", 42, "Y"]}',
    );
    expect(out!.include_categories).toEqual(["X", "Y"]);
  });

  it("omits reasoning when absent", () => {
    const out = parseTraversalDirective(
      '{"entities":[],"neighbors":"none","include_categories":[]}',
    );
    expect("reasoning" in out!).toBe(false);
  });

  it("preserves reasoning when present", () => {
    const out = parseTraversalDirective(
      '{"entities":[],"neighbors":"none","include_categories":[],"reasoning":"because"}',
    );
    expect(out!.reasoning).toBe("because");
  });

  it("falls back neighbors to 'none' when field is not a string", () => {
    const out = parseTraversalDirective(
      '{"entities":[],"neighbors":5,"include_categories":[]}',
    );
    expect(out!.neighbors).toBe("none");
  });

  it("coerces non-array include_categories to empty array", () => {
    const out = parseTraversalDirective(
      '{"entities":[],"neighbors":"none","include_categories":"X"}',
    );
    expect(out!.include_categories).toEqual([]);
  });
});

const mkManifest = (): Manifest => ({
  version: 2,
  retrieval: "graph",
  buildDate: "2026-01-01T00:00:00.000Z",
  source: "https://example.fandom.com",
  license: "CC-BY-SA",
  graph: { sectionMaxChars: 2000, leadMaxChars: 600, deadLinkCount: 0 },
  counts: { articles: 0, sections: 0, categories: 0, aliases: 0, edges: 0, events: 0 },
  timeline: { events: [] },
  timelineMeta: { articleTitle: "Timeline", eventCount: 0, minYear: 0, maxYear: 0 },
  files: {
    nodes: { path: "graph-nodes.json.gz", sizeBytes: 0, sha256: "0".repeat(64) },
    edges: { path: "graph-edges.json.gz", sizeBytes: 0, sha256: "0".repeat(64) },
    aliases: { path: "aliases.json.gz", sizeBytes: 0, sha256: "0".repeat(64) },
  },
});

const mkArticle = (id: string, title: string, categories: string[] = []): ArticleNode => ({
  kind: "article",
  id,
  title,
  categories,
  eventIds: [],
  latestEventOrder: -1,
  tags: [],
  lead: "",
  sectionIds: [],
});

const mkGraph = (articles: ArticleNode[], links: Record<string, string[]> = {}): LoadedGraph => {
  const articleMap = new Map<string, ArticleNode>();
  for (const a of articles) articleMap.set(a.id, a);
  const linksMap = new Map<string, Set<string>>();
  for (const [k, v] of Object.entries(links)) linksMap.set(k, new Set(v));
  return {
    manifest: mkManifest(),
    articles: articleMap,
    sections: new Map(),
    categories: new Map(),
    events: new Map(),
    edges: {
      links: linksMap,
      contains: new Map(),
      inCategory: new Map(),
      inEvent: new Map(),
      mentions: new Map(),
    },
    aliases: new Map(),
    eventOrder: new Map(),
  };
};

describe("warmEngram()", () => {
  it("returns empty vocab when engram is unknown", () => {
    const g = mkGraph([]);
    const v = warmEngram("ghost", g);
    expect(v).toEqual({ engramId: "ghost", names: [], categories: [] });
  });

  it("returns title + own categories when engram has no link neighbors", () => {
    const a = mkArticle("a", "Alpha", ["CatOne", "CatTwo"]);
    const g = mkGraph([a]);
    const v = warmEngram("a", g);
    expect(v.names).toEqual(["Alpha"]);
    expect(v.categories).toEqual(["CatOne", "CatTwo"]);
  });

  it("dedupes neighbor titles and categories", () => {
    const a = mkArticle("a", "Alpha", ["Shared"]);
    const b = mkArticle("b", "Alpha", ["Shared"]); // duplicate title + category
    const c = mkArticle("c", "Charlie", ["Other"]);
    const g = mkGraph([a, b, c], { a: ["b", "c"] });
    const v = warmEngram("a", g);
    expect(v.names).toEqual(["Alpha", "Charlie"]);
    expect(v.categories).toEqual(["Shared", "Other"]);
  });

  it("skips link neighbor ids that are missing from the articles map", () => {
    const a = mkArticle("a", "Alpha", ["CatA"]);
    const g = mkGraph([a], { a: ["missing", "also-missing"] });
    const v = warmEngram("a", g);
    expect(v.names).toEqual(["Alpha"]);
    expect(v.categories).toEqual(["CatA"]);
  });

  it("respects the 150-name / 40-category limits", () => {
    const neighbors: ArticleNode[] = [];
    const neighborIds: string[] = [];
    for (let i = 0; i < 200; i++) {
      const id = `n${i}`;
      neighbors.push(mkArticle(id, `Name${i}`, [`Cat${i}`]));
      neighborIds.push(id);
    }
    const seed = mkArticle("seed", "Seed", ["SeedCat"]);
    const g = mkGraph([seed, ...neighbors], { seed: neighborIds });
    const v = warmEngram("seed", g);
    expect(v.names.length).toBe(150);
    expect(v.categories.length).toBe(40);
  });
});

describe("buildResolverMessages()", () => {
  it("returns [system, user] with stable structure", () => {
    const [system, user] = buildResolverMessages({
      userQuery: "Who is V?",
      characterContext: { id: "persona-id", bio: "A merc." },
      entityVocab: { engramId: "persona-id", names: ["V", "Johnny"], categories: ["Characters"] },
    });
    expect(system.role).toBe("system");
    expect(system.content).toContain("entities");
    expect(system.content).toContain("neighbors");
    expect(system.content).toContain("include_categories");
    expect(system.content).toContain("reasoning");
    expect(user.role).toBe("user");
    expect(user.content).toContain("persona-id");
    expect(user.content).toContain("A merc.");
    expect(user.content).toContain("Who is V?");
    expect(user.content).toContain("V, Johnny");
    expect(user.content).toContain("Characters");
  });
});
