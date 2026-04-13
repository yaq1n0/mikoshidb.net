import { describe, it, expect } from "vitest";
import type { Manifest, TimelineEvent, TraversalDirective } from "../types.ts";
import type { LoadedGraph, ArticleNode, SectionNode, CategoryNode } from "./graph.ts";
import { traverse } from "./traverse.ts";

const mkManifest = (): Manifest => ({
  version: 2,
  retrieval: "graph",
  buildDate: "2026-01-01T00:00:00.000Z",
  source: "https://example.fandom.com",
  license: "CC-BY-SA",
  graph: { sectionMaxChars: 2000, leadMaxChars: 600, deadLinkCount: 0 },
  counts: { articles: 3, sections: 3, categories: 2, aliases: 5, edges: 2, events: 3 },
  timeline: { events: [] },
  timelineMeta: { articleTitle: "Timeline", eventCount: 3, minYear: 2013, maxYear: 2077 },
  files: {
    nodes: { path: "graph-nodes.json.gz", sizeBytes: 0, sha256: "0".repeat(64) },
    edges: { path: "graph-edges.json.gz", sizeBytes: 0, sha256: "0".repeat(64) },
    aliases: { path: "aliases.json.gz", sizeBytes: 0, sha256: "0".repeat(64) },
  },
});

type Fixture = {
  graph: LoadedGraph;
  events: TimelineEvent[];
};

const buildFixture = (): Fixture => {
  const e1: TimelineEvent = { id: "e1", name: "E1", year: 2013, order: 100 };
  const e2: TimelineEvent = { id: "e2", name: "E2", year: 2050, order: 200 };
  const e3: TimelineEvent = { id: "e3", name: "E3", year: 2077, order: 300 };

  const a: ArticleNode = {
    kind: "article",
    id: "a",
    title: "Alpha",
    categories: ["CatOne"],
    eventIds: [],
    latestEventOrder: -1,
    tags: ["cat-one"],
    lead: "Alpha lead text.",
    sectionIds: ["a#0"],
  };
  const b: ArticleNode = {
    kind: "article",
    id: "b",
    title: "Bravo",
    categories: ["Cat Two"],
    eventIds: [],
    latestEventOrder: 200,
    tags: ["cat-two"],
    lead: "Bravo lead.",
    sectionIds: ["b#0"],
  };
  const c: ArticleNode = {
    kind: "article",
    id: "c",
    title: "Charlie",
    categories: [],
    eventIds: [],
    latestEventOrder: -1,
    tags: [],
    lead: "Charlie lead.",
    sectionIds: ["c#0"],
  };
  const d: ArticleNode = {
    kind: "article",
    id: "d",
    title: "Delta",
    categories: [],
    eventIds: [],
    latestEventOrder: -1,
    tags: [],
    lead: "",
    sectionIds: [],
  };

  const secA: SectionNode = {
    kind: "section",
    id: "a#0",
    articleId: "a",
    heading: "Intro",
    text: "Alpha section text",
    latestEventOrder: -1,
    eventIds: [],
    tags: ["cat-one"],
  };
  const secB: SectionNode = {
    kind: "section",
    id: "b#0",
    articleId: "b",
    heading: "",
    text: "Bravo section",
    latestEventOrder: 200,
    eventIds: [],
    tags: ["cat-two"],
  };
  const secC: SectionNode = {
    kind: "section",
    id: "c#0",
    articleId: "c",
    heading: "Background",
    text: "Charlie section",
    latestEventOrder: -1,
    eventIds: [],
    tags: [],
  };

  const catOne: CategoryNode = {
    kind: "category",
    id: "cat-one",
    name: "CatOne",
    articleIds: ["a"],
  };
  const catTwo: CategoryNode = {
    kind: "category",
    id: "cat-two",
    name: "Cat Two",
    articleIds: ["b"],
  };

  const graph: LoadedGraph = {
    manifest: mkManifest(),
    articles: new Map([
      ["a", a],
      ["b", b],
      ["c", c],
      ["d", d],
    ]),
    sections: new Map([
      ["a#0", secA],
      ["b#0", secB],
      ["c#0", secC],
    ]),
    categories: new Map([
      ["cat-one", catOne],
      ["cat-two", catTwo],
    ]),
    events: new Map([
      ["e1", e1],
      ["e2", e2],
      ["e3", e3],
    ]),
    edges: {
      links: new Map([
        ["a", new Set(["b"])],
        ["b", new Set(["c"])],
      ]),
      contains: new Map(),
      inCategory: new Map(),
      inEvent: new Map(),
      mentions: new Map(),
    },
    aliases: new Map([
      ["alpha", "a"],
      ["the alpha one", "a"],
      ["bravo", "b"],
      ["charlie", "c"],
      ["delta", "d"],
    ]),
    eventOrder: new Map([
      ["e1", 100],
      ["e2", 200],
      ["e3", 300],
    ]),
  };

  return { graph, events: [e1, e2, e3] };
};

const directive = (over: Partial<TraversalDirective>): TraversalDirective => ({
  entities: [],
  neighbors: "none",
  include_categories: [],
  ...over,
});

describe("traverse() — entity resolution", () => {
  it("resolves a known alias and records it", () => {
    const { graph } = buildFixture();
    const { trace } = traverse(directive({ entities: ["Alpha"] }), graph, { id: "a", bio: "" });
    expect(trace.resolvedEntities).toEqual([{ alias: "Alpha", articleId: "a" }]);
    expect(trace.unresolvedEntities).toEqual([]);
  });

  it("records unknown aliases in trace.unresolvedEntities", () => {
    const { graph } = buildFixture();
    const { trace } = traverse(directive({ entities: ["Ghost"] }), graph, { id: "a", bio: "" });
    expect(trace.unresolvedEntities).toEqual(["Ghost"]);
  });

  it("dedupes multiple aliases that resolve to the same slug", () => {
    const { graph } = buildFixture();
    const { chunks, trace } = traverse(directive({ entities: ["Alpha", "the alpha one"] }), graph, {
      id: "a",
      bio: "",
    });
    expect(trace.resolvedEntities).toHaveLength(1);
    // Only one seed means only one lead chunk.
    expect(chunks.filter((c) => c.source === "lead")).toHaveLength(1);
  });
});

describe("traverse() — neighbors", () => {
  it("'none' emits only seed lead + sections (hop 0)", () => {
    const { graph } = buildFixture();
    const { chunks } = traverse(directive({ entities: ["Alpha"] }), graph, { id: "a", bio: "" });
    expect(chunks.every((c) => c.hops === 0)).toBe(true);
    expect(chunks.map((c) => c.source).sort()).toEqual(["lead", "section"]);
  });

  it("'direct' pulls 1-hop neighbors with source=neighbor", () => {
    const { graph } = buildFixture();
    const { chunks } = traverse(directive({ entities: ["Alpha"], neighbors: "direct" }), graph, {
      id: "a",
      bio: "",
    });
    expect(chunks.some((c) => c.source === "neighbor" && c.chunk.articleId === "b")).toBe(true);
    // 2-hop neighbor C should NOT appear.
    expect(chunks.find((c) => c.chunk.articleId === "c")).toBeUndefined();
  });

  it("'two_hop' pulls 2-hop neighbors", () => {
    const { graph } = buildFixture();
    const { chunks } = traverse(directive({ entities: ["Alpha"], neighbors: "two_hop" }), graph, {
      id: "a",
      bio: "",
    });
    expect(chunks.some((c) => c.chunk.articleId === "b")).toBe(true);
    expect(chunks.some((c) => c.chunk.articleId === "c")).toBe(true);
  });
});

describe("traverse() — include_categories", () => {
  it("seeds articles from matching slugified category at hop 1", () => {
    const { graph } = buildFixture();
    const { chunks } = traverse(
      directive({ entities: [], include_categories: ["Cat Two"] }),
      graph,
      { id: "a", bio: "" },
    );
    expect(chunks.some((c) => c.chunk.articleId === "b")).toBe(true);
    const bChunk = chunks.find((c) => c.chunk.articleId === "b")!;
    expect(bChunk.hops).toBe(1);
    expect(bChunk.source).toBe("neighbor");
  });

  it("no-op for unknown category name", () => {
    const { graph } = buildFixture();
    const { chunks } = traverse(directive({ entities: [], include_categories: ["Ghost"] }), graph, {
      id: "a",
      bio: "",
    });
    expect(chunks).toEqual([]);
  });
});

describe("traverse() — cutoff", () => {
  it("drops chunks whose latestEventOrder exceeds cutoff event order", () => {
    const { graph } = buildFixture();
    const { chunks, trace } = traverse(
      directive({ entities: ["Alpha"], neighbors: "direct" }),
      graph,
      { id: "a", bio: "", cutoffEventId: "e1" },
    );
    expect(chunks.find((c) => c.chunk.articleId === "b")).toBeUndefined();
    expect(trace.nodes.some((n) => n.droppedReason === "cutoff")).toBe(true);
  });

  it("latestEventOrder of -1 always passes", () => {
    const { graph } = buildFixture();
    const { chunks } = traverse(directive({ entities: ["Alpha"] }), graph, {
      id: "a",
      bio: "",
      cutoffEventId: "e1",
    });
    expect(chunks.some((c) => c.chunk.articleId === "a")).toBe(true);
  });

  it("__LAST_EVENT__ cutoff means no cutoff", () => {
    const { graph } = buildFixture();
    const { chunks } = traverse(directive({ entities: ["Alpha"], neighbors: "direct" }), graph, {
      id: "a",
      bio: "",
      cutoffEventId: "__LAST_EVENT__",
    });
    expect(chunks.some((c) => c.chunk.articleId === "b")).toBe(true);
  });

  it("unknown cutoff id means no cutoff", () => {
    const { graph } = buildFixture();
    const { chunks } = traverse(directive({ entities: ["Alpha"], neighbors: "direct" }), graph, {
      id: "a",
      bio: "",
      cutoffEventId: "missing-event",
    });
    expect(chunks.some((c) => c.chunk.articleId === "b")).toBe(true);
  });
});

describe("traverse() — tag filter", () => {
  it("keeps chunks whose tags do not intersect the excludeTags set", () => {
    const { graph } = buildFixture();
    const { chunks } = traverse(directive({ entities: ["Alpha"] }), graph, {
      id: "a",
      bio: "",
      excludeTags: ["no-such-tag"],
    });
    expect(chunks.some((c) => c.chunk.articleId === "a")).toBe(true);
  });

  it("drops chunks with excluded tags and records droppedReason", () => {
    const { graph } = buildFixture();
    const { chunks, trace } = traverse(directive({ entities: ["Alpha"] }), graph, {
      id: "a",
      bio: "",
      excludeTags: ["cat-one"],
    });
    expect(chunks.every((c) => c.chunk.articleId !== "a")).toBe(true);
    expect(trace.nodes.some((n) => n.droppedReason === "excluded-tag")).toBe(true);
  });
});

describe("traverse() — misc", () => {
  it("respects maxChunks cap", () => {
    const { graph } = buildFixture();
    const { chunks } = traverse(
      directive({ entities: ["Alpha"], neighbors: "two_hop" }),
      graph,
      { id: "a", bio: "" },
      { maxChunks: 1 },
    );
    expect(chunks.length).toBeLessThanOrEqual(1);
  });

  it("sorts by hops asc then chunk.id asc", () => {
    const { graph } = buildFixture();
    const { chunks } = traverse(directive({ entities: ["Alpha"], neighbors: "direct" }), graph, {
      id: "a",
      bio: "",
    });
    for (let i = 1; i < chunks.length; i++) {
      const prev = chunks[i - 1];
      const cur = chunks[i];
      if (prev.hops === cur.hops) {
        expect(prev.chunk.id.localeCompare(cur.chunk.id)).toBeLessThanOrEqual(0);
      } else {
        expect(prev.hops).toBeLessThanOrEqual(cur.hops);
      }
    }
  });

  it("falls back to article.title when article.lead is empty", () => {
    const { graph } = buildFixture();
    const { chunks } = traverse(directive({ entities: ["Delta"] }), graph, { id: "d", bio: "" });
    const lead = chunks.find((c) => c.source === "lead" && c.chunk.articleId === "d")!;
    expect(lead.chunk.text).toBe("Delta");
  });

  it("header: [Title] for lead, [Title > Heading] for section, 'intro' fallback for empty heading", () => {
    const { graph } = buildFixture();
    const { chunks } = traverse(directive({ entities: ["Bravo"] }), graph, { id: "b", bio: "" });
    const lead = chunks.find((c) => c.source === "lead")!;
    const sec = chunks.find((c) => c.source === "section")!;
    expect(lead.chunk.header).toBe("[Bravo]");
    expect(sec.chunk.header).toBe("[Bravo > intro]");
  });

  it("header shows section heading when present", () => {
    const { graph } = buildFixture();
    const { chunks } = traverse(directive({ entities: ["Alpha"] }), graph, { id: "a", bio: "" });
    const sec = chunks.find((c) => c.source === "section")!;
    expect(sec.chunk.header).toBe("[Alpha > Intro]");
  });

  it("records 'unknown-article' trace when a link edge points to a missing article id", () => {
    const { graph } = buildFixture();
    graph.edges.links.set("a", new Set(["b", "ghost-article"]));
    const { trace } = traverse(directive({ entities: ["Alpha"], neighbors: "direct" }), graph, {
      id: "a",
      bio: "",
    });
    expect(trace.nodes.some((n) => n.droppedReason === "unknown-article")).toBe(true);
  });

  it("neighbor chunk uses [Title] header", () => {
    const { graph } = buildFixture();
    const { chunks } = traverse(directive({ entities: ["Alpha"], neighbors: "direct" }), graph, {
      id: "a",
      bio: "",
    });
    const n = chunks.find((c) => c.source === "neighbor")!;
    expect(n.chunk.header).toBe("[Bravo]");
  });
});
