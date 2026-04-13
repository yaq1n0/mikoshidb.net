import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import type { OpensonaConfig, Timeline, TimelineMeta } from "../types.ts";
import type { GraphArtifact } from "./graph.ts";
import { countEdges } from "./graph.ts";
import { packGraph } from "./pack-graph.ts";

const baseConfig = (over?: Partial<OpensonaConfig>): OpensonaConfig =>
  ({
    dumpPath: "dump.xml",
    generatedDir: "out",
    source: "https://example.fandom.com",
    license: "CC-BY-SA",
    graph: {
      sectionMaxChars: 2000,
      leadMaxChars: 600,
      dropDeadLinks: true,
      includeMentionsEdges: false,
    },
    maxBundleBytes: 50_000_000,
    timelineArticleTitle: "Timeline",
    timelineValidation: { minYearHeadings: 0, minEvents: 0 },
    editionEras: [],
    categorySkip: { prefixes: [], suffixes: [], exact: [] },
    ...over,
  }) as OpensonaConfig;

const buildArtifact = (): GraphArtifact => ({
  nodes: {
    articles: new Map([
      [
        "a",
        {
          kind: "article",
          id: "a",
          title: "A",
          categories: ["C"],
          eventIds: [],
          latestEventOrder: -1,
          tags: ["c"],
          lead: "alpha",
          sectionIds: ["a#0"],
        },
      ],
    ]),
    sections: new Map([
      [
        "a#0",
        {
          kind: "section",
          id: "a#0",
          articleId: "a",
          heading: "Intro",
          text: "alpha-intro",
          latestEventOrder: -1,
          eventIds: [],
          tags: ["c"],
        },
      ],
    ]),
    categories: new Map([["c", { kind: "category", id: "c", name: "C", articleIds: ["a"] }]]),
    events: new Map(),
  },
  edges: {
    links: new Map([["a", new Set(["b"])]]),
    contains: new Map([["a", new Set(["a#0"])]]),
    inCategory: new Map([["a", new Set(["c"])]]),
    inEvent: new Map(),
    mentions: new Map(),
  },
  aliases: new Map([["a", "a"]]),
  deadLinkCount: 3,
});

const timeline: Timeline = { events: [] };
const timelineMeta: TimelineMeta = {
  articleTitle: "Timeline",
  eventCount: 0,
  minYear: 0,
  maxYear: 0,
};

describe("packGraph()", () => {
  it("emits three gzipped files in order with non-zero bytes and valid JSON content", async () => {
    const art = buildArtifact();
    const { files } = await packGraph(art, { timeline, timelineMeta, config: baseConfig() });
    expect(files.map((f) => f.path)).toEqual([
      "graph-nodes.json.gz",
      "graph-edges.json.gz",
      "aliases.json.gz",
    ]);
    for (const f of files) expect(f.data.byteLength).toBeGreaterThan(0);

    const nodes = JSON.parse(gunzipSync(Buffer.from(files[0].data)).toString("utf-8"));
    const edges = JSON.parse(gunzipSync(Buffer.from(files[1].data)).toString("utf-8"));
    const aliases = JSON.parse(gunzipSync(Buffer.from(files[2].data)).toString("utf-8"));

    expect(nodes.articles).toHaveLength(1);
    expect(edges.links.a).toEqual(["b"]);
    expect(aliases.a).toBe("a");
  });

  it("manifest counts match the artifact sizes and use countEdges()", async () => {
    const art = buildArtifact();
    const { manifest } = await packGraph(art, { timeline, timelineMeta, config: baseConfig() });
    expect(manifest.version).toBe(2);
    expect(manifest.retrieval).toBe("graph");
    expect(Number.isNaN(Date.parse(manifest.buildDate))).toBe(false);
    expect(manifest.counts.articles).toBe(1);
    expect(manifest.counts.sections).toBe(1);
    expect(manifest.counts.categories).toBe(1);
    expect(manifest.counts.aliases).toBe(1);
    expect(manifest.counts.events).toBe(0);
    expect(manifest.counts.edges).toBe(countEdges(art.edges));
  });

  it("manifest files carry SHA-256 hex that matches the gzipped bytes", async () => {
    const art = buildArtifact();
    const { manifest, files } = await packGraph(art, {
      timeline,
      timelineMeta,
      config: baseConfig(),
    });
    const expected = createHash("sha256").update(files[0].data).digest("hex");
    expect(manifest.files.nodes.sha256).toBe(expected);
    expect(manifest.files.nodes.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.files.edges.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.files.aliases.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("throws when total bytes exceed maxBundleBytes", async () => {
    const art = buildArtifact();
    await expect(
      packGraph(art, { timeline, timelineMeta, config: baseConfig({ maxBundleBytes: 1 }) }),
    ).rejects.toThrow(/maxBundleBytes/);
  });

  it("adjacency map → object preserves membership", async () => {
    const art = buildArtifact();
    art.edges.links.set("x", new Set(["y", "z"]));
    const { files } = await packGraph(art, { timeline, timelineMeta, config: baseConfig() });
    const edges = JSON.parse(gunzipSync(Buffer.from(files[1].data)).toString("utf-8"));
    expect([...edges.links.x].sort()).toEqual(["y", "z"]);
  });

  it("node map → array preserves all values", async () => {
    const art = buildArtifact();
    const { files } = await packGraph(art, { timeline, timelineMeta, config: baseConfig() });
    const nodes = JSON.parse(gunzipSync(Buffer.from(files[0].data)).toString("utf-8"));
    expect(nodes.articles[0].id).toBe("a");
    expect(nodes.sections[0].id).toBe("a#0");
    expect(nodes.categories[0].id).toBe("c");
  });
});
