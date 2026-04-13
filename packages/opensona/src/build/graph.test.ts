import { describe, it, expect } from "vitest";
import type { OpensonaConfig, Timeline } from "../types.ts";
import type { ParsedArticle } from "./parse.ts";
import type { CategoryEventMap } from "./prebuild-categories.ts";
import { buildGraph, countEdges, parseSectionYear } from "./graph.ts";

const cfg = (over?: Partial<OpensonaConfig["graph"]>): OpensonaConfig =>
  ({
    dumpPath: "dump.xml",
    generatedDir: "out",
    source: "https://example.fandom.com",
    license: "CC-BY-SA",
    graph: {
      sectionMaxChars: 2000,
      leadMaxChars: 600,
      dropDeadLinks: true,
      includeMentionsEdges: true,
      ...over,
    },
    maxBundleBytes: 50_000_000,
    timelineArticleTitle: "Timeline",
    timelineValidation: { minYearHeadings: 0, minEvents: 0 },
    editionEras: [],
    categorySkip: { prefixes: [], suffixes: [], exact: [] },
  }) as OpensonaConfig;

const mkArticle = (over: Partial<ParsedArticle>): ParsedArticle => ({
  title: "Default",
  slug: "default",
  sections: [],
  categories: [],
  links: [],
  infobox: {},
  ...over,
});

describe("parseSectionYear()", () => {
  it("returns the latest year when multiple are present", () => {
    expect(parseSectionYear("Events of 2013 and 2077")).toBe(2077);
  });

  it("handles decade suffix '2010s' → 2010", () => {
    expect(parseSectionYear("2010s overview")).toBe(2010);
  });

  it("returns null for headings with no year", () => {
    expect(parseSectionYear("Background")).toBeNull();
  });

  it("returns max of mixed years", () => {
    expect(parseSectionYear("From 1999 to 2020")).toBe(2020);
  });
});

const timeline: Timeline = {
  events: [
    { id: "e2013", name: "E2013", year: 2013, order: 201300 },
    { id: "e2077", name: "E2077", year: 2077, order: 207700 },
  ],
};

const catMap: CategoryEventMap = {
  mapping: { Cat2013: "e2013", Cat2077: "e2077" },
  skipped: [],
};

const buildFixture = (): {
  articles: ParsedArticle[];
  timeline: Timeline;
  catMap: CategoryEventMap;
} => {
  const A = mkArticle({
    title: "A",
    slug: "a",
    categories: ["Cat2077"],
    links: ["B", "Ghost", "A"], // self-link + dead link
    sections: [
      { heading: "Intro", text: "Alpha lead text.", links: ["B"] },
      { heading: "Events of 2030", text: "2030 stuff", links: [] },
    ],
  });
  const B = mkArticle({
    title: "B",
    slug: "b",
    categories: ["Cat2013"],
    links: ["C"],
    sections: [{ heading: "Background", text: "Bravo text", links: ["A"] }],
  });
  const C = mkArticle({
    title: "C",
    slug: "c",
    categories: [],
    links: ["Nonexistent"],
    sections: [{ heading: "Orphan", text: "Charlie text", links: [] }],
  });
  return { articles: [A, B, C], timeline, catMap };
};

describe("buildGraph()", () => {
  it("populates article / section / category / event node maps", () => {
    const { articles } = buildFixture();
    const g = buildGraph(articles, [], timeline, catMap, cfg());
    expect([...g.nodes.articles.keys()].sort()).toEqual(["a", "b", "c"]);
    expect(g.nodes.sections.size).toBe(4);
    expect(g.nodes.categories.size).toBe(2);
    expect(g.nodes.events.size).toBe(2);
  });

  it("records article→article link edges, skipping self-links", () => {
    const { articles } = buildFixture();
    const g = buildGraph(articles, [], timeline, catMap, cfg());
    expect([...(g.edges.links.get("a") ?? [])]).toEqual(["b"]);
    expect([...(g.edges.links.get("b") ?? [])]).toEqual(["c"]);
  });

  it("contains edge per section", () => {
    const { articles } = buildFixture();
    const g = buildGraph(articles, [], timeline, catMap, cfg());
    expect([...(g.edges.contains.get("a") ?? [])].sort()).toEqual(["a#0", "a#1"]);
    expect([...(g.edges.contains.get("b") ?? [])]).toEqual(["b#0"]);
  });

  it("inCategory edge from article to slugified category id", () => {
    const { articles } = buildFixture();
    const g = buildGraph(articles, [], timeline, catMap, cfg());
    expect([...(g.edges.inCategory.get("a") ?? [])]).toEqual(["cat2077"]);
    expect([...(g.edges.inCategory.get("b") ?? [])]).toEqual(["cat2013"]);
  });

  it("inEvent edges for articles with category-derived events and for sections too", () => {
    const { articles } = buildFixture();
    const g = buildGraph(articles, [], timeline, catMap, cfg());
    expect(g.edges.inEvent.get("a")?.has("e2077")).toBe(true);
    expect(g.edges.inEvent.get("b")?.has("e2013")).toBe(true);
    expect(g.edges.inEvent.get("a#0")?.has("e2077")).toBe(true);
    expect(g.edges.inEvent.has("c")).toBe(false);
  });

  it("mentions edges populated iff includeMentionsEdges", () => {
    const { articles } = buildFixture();
    const on = buildGraph(articles, [], timeline, catMap, cfg({ includeMentionsEdges: true }));
    expect(on.edges.mentions.get("a#0")?.has("b")).toBe(true);
    const off = buildGraph(articles, [], timeline, catMap, cfg({ includeMentionsEdges: false }));
    expect(off.edges.mentions.size).toBe(0);
  });

  it("counts unresolved article links as dead links when dropDeadLinks=true", () => {
    const { articles } = buildFixture();
    const g = buildGraph(articles, [], timeline, catMap, cfg({ dropDeadLinks: true }));
    // A has "Ghost" (dead), C has "Nonexistent" (dead). A→A is a self-link, not a dead link.
    expect(g.deadLinkCount).toBe(2);
  });

  it("does not increment deadLinkCount when dropDeadLinks=false", () => {
    const { articles } = buildFixture();
    const g = buildGraph(articles, [], timeline, catMap, cfg({ dropDeadLinks: false }));
    expect(g.deadLinkCount).toBe(0);
  });

  it("prefers sentence-boundary truncation for article lead when past 60% of leadMaxChars", () => {
    const prefix = "A".repeat(65);
    const text = prefix + ". Continued text " + "B".repeat(120);
    const a = mkArticle({
      title: "L",
      slug: "l",
      sections: [{ heading: "Intro", text, links: [] }],
    });
    const g = buildGraph(
      [a],
      [],
      { events: [] },
      { mapping: {}, skipped: [] },
      cfg({ leadMaxChars: 100 }),
    );
    const node = g.nodes.articles.get("l")!;
    expect(node.lead.endsWith(".")).toBe(true);
    expect(node.lead.length).toBeLessThanOrEqual(100);
  });

  it("promotes article latestEventOrder to the max of category floor and section year floor", () => {
    const { articles } = buildFixture();
    const g = buildGraph(articles, [], timeline, catMap, cfg());
    // Article A has Cat2077 (floor 207700) and a section "Events of 2030"
    // (floor 2030*100+1 = 203001). Max = 207700.
    expect(g.nodes.articles.get("a")!.latestEventOrder).toBe(207700);
    // Article B has Cat2013 (floor 201300) and section "Background" (no year → -1).
    expect(g.nodes.articles.get("b")!.latestEventOrder).toBe(201300);
    expect(g.nodes.articles.get("c")!.latestEventOrder).toBe(-1);
  });
});

describe("countEdges()", () => {
  it("sums edge counts across all five edge maps", () => {
    const { articles } = buildFixture();
    const g = buildGraph(articles, [], timeline, catMap, cfg());
    const manual =
      [...g.edges.links.values()].reduce((n, s) => n + s.size, 0) +
      [...g.edges.contains.values()].reduce((n, s) => n + s.size, 0) +
      [...g.edges.inCategory.values()].reduce((n, s) => n + s.size, 0) +
      [...g.edges.inEvent.values()].reduce((n, s) => n + s.size, 0) +
      [...g.edges.mentions.values()].reduce((n, s) => n + s.size, 0);
    expect(countEdges(g.edges)).toBe(manual);
  });
});
