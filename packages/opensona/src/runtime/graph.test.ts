import { describe, it, expect } from "vitest";
import type { Manifest } from "../types.ts";
import { hydrateGraph, type RawEdgesPayload, type RawNodesPayload } from "./graph.ts";

const mkManifest = (eventsOrder: number[]): Manifest => ({
  version: 2,
  retrieval: "graph",
  buildDate: "2026-01-01T00:00:00.000Z",
  source: "https://example.fandom.com",
  license: "CC-BY-SA",
  graph: { sectionMaxChars: 2000, leadMaxChars: 600, deadLinkCount: 0 },
  counts: {
    articles: 0,
    sections: 0,
    categories: 0,
    aliases: 0,
    edges: 0,
    events: eventsOrder.length,
  },
  timeline: {
    events: eventsOrder.map((order, i) => ({
      id: `e${i}`,
      name: `E${i}`,
      year: 2000 + i,
      order,
    })),
  },
  timelineMeta: {
    articleTitle: "Timeline",
    eventCount: eventsOrder.length,
    minYear: 2000,
    maxYear: 2100,
  },
  files: {
    nodes: { path: "graph-nodes.json.gz", sizeBytes: 0, sha256: "0".repeat(64) },
    edges: { path: "graph-edges.json.gz", sizeBytes: 0, sha256: "0".repeat(64) },
    aliases: { path: "aliases.json.gz", sizeBytes: 0, sha256: "0".repeat(64) },
  },
});

describe("hydrateGraph()", () => {
  it("converts arrays to Maps keyed by id, adjacency objects to Sets", () => {
    const manifest = mkManifest([100, 200]);
    const nodes: RawNodesPayload = {
      articles: [
        {
          kind: "article",
          id: "a",
          title: "A",
          categories: [],
          eventIds: [],
          latestEventOrder: -1,
          tags: [],
          lead: "",
          sectionIds: [],
        },
      ],
      sections: [
        {
          kind: "section",
          id: "a#0",
          articleId: "a",
          heading: "",
          text: "",
          latestEventOrder: -1,
          eventIds: [],
          tags: [],
        },
      ],
      categories: [{ kind: "category", id: "c", name: "C", articleIds: ["a"] }],
    };
    const edges: RawEdgesPayload = {
      links: { a: ["b", "c"] },
      contains: {},
      inCategory: {},
      inEvent: {},
      mentions: {},
    };
    const g = hydrateGraph(manifest, nodes, edges, { alpha: "a", beta: "b" });

    expect(g.articles.get("a")!.id).toBe("a");
    expect(g.sections.get("a#0")!.articleId).toBe("a");
    expect(g.categories.get("c")!.name).toBe("C");
    expect(g.edges.links.get("a")).toBeInstanceOf(Set);
    expect([...g.edges.links.get("a")!].sort()).toEqual(["b", "c"]);
    expect(g.aliases.get("alpha")).toBe("a");
    expect(g.aliases.get("beta")).toBe("b");
    expect(g.eventOrder.get("e0")).toBe(100);
    expect(g.eventOrder.get("e1")).toBe(200);
  });

  it("produces empty maps for empty payloads without crashing", () => {
    const manifest = mkManifest([]);
    const g = hydrateGraph(
      manifest,
      { articles: [], sections: [], categories: [] },
      { links: {}, contains: {}, inCategory: {}, inEvent: {}, mentions: {} },
      {},
    );
    expect(g.articles.size).toBe(0);
    expect(g.sections.size).toBe(0);
    expect(g.categories.size).toBe(0);
    expect(g.events.size).toBe(0);
    expect(g.aliases.size).toBe(0);
    expect(g.edges.links.size).toBe(0);
  });
});
