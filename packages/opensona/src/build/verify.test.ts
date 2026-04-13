import { describe, it, expect } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import type { Manifest } from "../types.ts";
import type { LoadedGraph, ArticleNode, SectionNode, CategoryNode } from "../runtime/graph.ts";
import { verifyBundle, verifyIntegrity, type GraphVerifyCase } from "./verify.ts";

const mkManifest = (over?: Partial<Manifest>): Manifest => ({
  version: 2,
  retrieval: "graph",
  buildDate: "2026-01-01T00:00:00.000Z",
  source: "https://example.fandom.com",
  license: "CC-BY-SA",
  graph: { sectionMaxChars: 2000, leadMaxChars: 600, deadLinkCount: 0 },
  counts: { articles: 2, sections: 2, categories: 1, aliases: 3, edges: 1, events: 1 },
  timeline: { events: [{ id: "e1", name: "E1", year: 2020, order: 100 }] },
  timelineMeta: { articleTitle: "Timeline", eventCount: 1, minYear: 2020, maxYear: 2020 },
  files: {
    nodes: { path: "graph-nodes.json.gz", sizeBytes: 1, sha256: "a".repeat(64) },
    edges: { path: "graph-edges.json.gz", sizeBytes: 1, sha256: "b".repeat(64) },
    aliases: { path: "aliases.json.gz", sizeBytes: 1, sha256: "c".repeat(64) },
  },
  ...over,
});

const mkArticle = (id: string, over?: Partial<ArticleNode>): ArticleNode => ({
  kind: "article",
  id,
  title: id.toUpperCase(),
  categories: [],
  eventIds: [],
  latestEventOrder: -1,
  tags: [],
  lead: `${id} lead`,
  sectionIds: [`${id}#0`],
  ...over,
});

const mkSection = (id: string, articleId: string, over?: Partial<SectionNode>): SectionNode => ({
  kind: "section",
  id,
  articleId,
  heading: "Intro",
  text: `${id} text`,
  latestEventOrder: -1,
  eventIds: [],
  tags: [],
  ...over,
});

const mkCategory = (id: string, articleIds: string[]): CategoryNode => ({
  kind: "category",
  id,
  name: id,
  articleIds,
});

const goodGraph = (): LoadedGraph => ({
  manifest: mkManifest(),
  articles: new Map([
    ["a", mkArticle("a")],
    ["b", mkArticle("b")],
  ]),
  sections: new Map([
    ["a#0", mkSection("a#0", "a")],
    ["b#0", mkSection("b#0", "b")],
  ]),
  categories: new Map([["c", mkCategory("c", ["a"])]]),
  events: new Map(),
  edges: {
    links: new Map([["a", new Set(["b"])]]),
    contains: new Map(),
    inCategory: new Map(),
    inEvent: new Map(),
    mentions: new Map(),
  },
  aliases: new Map([
    ["alpha", "a"],
    ["bravo", "b"],
  ]),
  eventOrder: new Map([["e1", 100]]),
});

describe("verifyIntegrity()", () => {
  it("passes clean graph with empty dangling arrays", () => {
    const r = verifyIntegrity(goodGraph());
    expect(r.passed).toBe(true);
    expect(r.dangling.aliasTarget).toEqual([]);
    expect(r.dangling.sectionArticle).toEqual([]);
    expect(r.dangling.categoryArticle).toEqual([]);
    expect(r.dangling.edgeSrc).toEqual([]);
    expect(r.dangling.edgeDst).toEqual([]);
    expect(r.dangling.nodeEventIds).toEqual([]);
  });

  it("flags aliases pointing to missing articles", () => {
    const g = goodGraph();
    g.aliases.set("ghost", "nonexistent");
    const r = verifyIntegrity(g);
    expect(r.passed).toBe(false);
    expect(r.dangling.aliasTarget.some((s) => s.includes("nonexistent"))).toBe(true);
  });

  it("flags sections referencing missing articles", () => {
    const g = goodGraph();
    g.sections.set("x#0", mkSection("x#0", "missing"));
    const r = verifyIntegrity(g);
    expect(r.dangling.sectionArticle.some((s) => s.includes("missing"))).toBe(true);
    expect(r.passed).toBe(false);
  });

  it("flags categories referencing missing articles", () => {
    const g = goodGraph();
    g.categories.set("bad", mkCategory("bad", ["nope"]));
    const r = verifyIntegrity(g);
    expect(r.dangling.categoryArticle.some((s) => s.includes("nope"))).toBe(true);
    expect(r.passed).toBe(false);
  });

  it("flags dangling edge src/dst and still counts destinations", () => {
    const g = goodGraph();
    g.edges.links.set("ghost", new Set(["phantom"]));
    const r = verifyIntegrity(g);
    expect(r.dangling.edgeSrc.some((s) => s.includes("ghost"))).toBe(true);
    expect(r.dangling.edgeDst.some((s) => s.includes("phantom"))).toBe(true);
    // edgeCount counts all destinations including dangling ones
    expect(r.edgeCount).toBe(2); // a→b and ghost→phantom
  });

  it("flags unresolved article / section eventIds", () => {
    const g = goodGraph();
    const a = g.articles.get("a")!;
    a.eventIds = ["unknown-event"];
    const sec = g.sections.get("a#0")!;
    sec.eventIds = ["another-unknown"];
    const r = verifyIntegrity(g);
    expect(r.dangling.nodeEventIds.some((s) => s.includes("article:a"))).toBe(true);
    expect(r.dangling.nodeEventIds.some((s) => s.includes("section:a#0"))).toBe(true);
  });
});

const gzJson = (value: unknown): Uint8Array =>
  gzipSync(Buffer.from(JSON.stringify(value), "utf-8"));

const writeBundle = async (
  dir: string,
  manifest: Manifest,
  nodes: unknown,
  edges: unknown,
  aliases: unknown,
): Promise<void> => {
  await writeFile(join(dir, "manifest.json"), JSON.stringify(manifest));
  await writeFile(join(dir, "graph-nodes.json.gz"), gzJson(nodes));
  await writeFile(join(dir, "graph-edges.json.gz"), gzJson(edges));
  await writeFile(join(dir, "aliases.json.gz"), gzJson(aliases));
};

const bundleNodes = {
  articles: [
    {
      kind: "article",
      id: "a",
      title: "Alpha",
      categories: [],
      eventIds: [],
      latestEventOrder: -1,
      tags: ["tag-a"],
      lead: "Alpha lead",
      sectionIds: [],
    },
    {
      kind: "article",
      id: "b",
      title: "Bravo",
      categories: [],
      eventIds: [],
      latestEventOrder: 500,
      tags: [],
      lead: "Bravo lead",
      sectionIds: [],
    },
  ],
  sections: [],
  categories: [],
};
const bundleEdges = {
  links: { a: ["b"] },
  contains: {},
  inCategory: {},
  inEvent: {},
  mentions: {},
};
const bundleAliases = { alpha: "a", bravo: "b" };

describe("verifyBundle()", () => {
  it("throws when manifest version is not 2", async () => {
    const dir = await mkdtemp(join(tmpdir(), "opensona-verify-"));
    try {
      await writeBundle(
        dir,
        mkManifest({ version: 1 as unknown as 2 }),
        bundleNodes,
        bundleEdges,
        bundleAliases,
      );
      await expect(verifyBundle(dir, [])).rejects.toThrow(/unsupported bundle/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("runs alias cases with expectArticleIds, expectAny, mustNotArticleIds, expectEmpty, assertNoPostCutoff", async () => {
    const dir = await mkdtemp(join(tmpdir(), "opensona-verify-"));
    try {
      await writeBundle(dir, mkManifest(), bundleNodes, bundleEdges, bundleAliases);
      const cases: GraphVerifyCase[] = [
        {
          id: "hit",
          query: "q",
          layer: "alias",
          alias: "alpha",
          neighbors: "none",
          characterContext: { id: "a", bio: "" },
          expectArticleIds: ["a"],
        },
        {
          id: "miss-expect",
          query: "q",
          layer: "alias",
          alias: "alpha",
          neighbors: "none",
          characterContext: { id: "a", bio: "" },
          expectArticleIds: ["z"],
        },
        {
          id: "any-hit",
          query: "q",
          layer: "alias",
          alias: "alpha",
          neighbors: "none",
          characterContext: { id: "a", bio: "" },
          expectAny: ["a", "z"],
        },
        {
          id: "any-miss",
          query: "q",
          layer: "alias",
          alias: "alpha",
          neighbors: "none",
          characterContext: { id: "a", bio: "" },
          expectAny: ["z"],
        },
        {
          id: "must-not-violated",
          query: "q",
          layer: "alias",
          alias: "alpha",
          neighbors: "none",
          characterContext: { id: "a", bio: "" },
          mustNotArticleIds: ["a"],
        },
        {
          id: "empty-ok",
          query: "q",
          layer: "alias",
          alias: "ghost",
          neighbors: "none",
          characterContext: { id: "a", bio: "" },
          expectEmpty: true,
        },
        {
          id: "post-cutoff-ok",
          query: "q",
          layer: "alias",
          alias: "alpha",
          neighbors: "direct",
          characterContext: { id: "a", bio: "", cutoffEventId: "__LAST_EVENT__" },
          assertNoPostCutoff: true,
        },
      ];
      const report = await verifyBundle(dir, cases);
      const byId = Object.fromEntries(report.cases.map((c) => [c.id, c]));
      expect(byId["hit"].passed).toBe(true);
      expect(byId["miss-expect"].passed).toBe(false);
      expect(byId["any-hit"].passed).toBe(true);
      expect(byId["any-miss"].passed).toBe(false);
      expect(byId["must-not-violated"].passed).toBe(false);
      expect(byId["empty-ok"].passed).toBe(true);
      expect(byId["post-cutoff-ok"].passed).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("allowFailure:true records failure but does not set blocked", async () => {
    const dir = await mkdtemp(join(tmpdir(), "opensona-verify-"));
    try {
      await writeBundle(dir, mkManifest(), bundleNodes, bundleEdges, bundleAliases);
      const cases: GraphVerifyCase[] = [
        {
          id: "soft",
          query: "q",
          layer: "alias",
          alias: "alpha",
          neighbors: "none",
          characterContext: { id: "a", bio: "" },
          expectArticleIds: ["z"],
          allowFailure: true,
        },
      ];
      const report = await verifyBundle(dir, cases);
      expect(report.cases[0].passed).toBe(false);
      expect(report.cases[0].allowedFailure).toBe(true);
      expect(report.blocked).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("records unresolved-alias failure only when expectArticleIds is non-empty and retrieval empty", async () => {
    const dir = await mkdtemp(join(tmpdir(), "opensona-verify-"));
    try {
      await writeBundle(dir, mkManifest(), bundleNodes, bundleEdges, bundleAliases);
      const cases: GraphVerifyCase[] = [
        {
          id: "unresolved-expect",
          query: "q",
          layer: "alias",
          alias: "ghost",
          neighbors: "none",
          characterContext: { id: "a", bio: "" },
          expectArticleIds: ["a"],
        },
      ];
      const report = await verifyBundle(dir, cases);
      expect(report.cases[0].passed).toBe(false);
      expect(report.cases[0].failures.some((f) => f.includes("unresolved"))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("marks unsupported 'llm' layer as soft failure per case", async () => {
    const dir = await mkdtemp(join(tmpdir(), "opensona-verify-"));
    try {
      await writeBundle(dir, mkManifest(), bundleNodes, bundleEdges, bundleAliases);
      const cases: GraphVerifyCase[] = [
        {
          id: "llm",
          query: "q",
          layer: "llm" as unknown as "alias",
          characterContext: { id: "a", bio: "" },
        },
      ];
      const report = await verifyBundle(dir, cases);
      expect(report.cases[0].passed).toBe(false);
      expect(report.cases[0].allowedFailure).toBe(true);
      expect(report.cases[0].failures[0]).toMatch(/unsupported layer/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("flags a case that provides neither alias nor aliases", async () => {
    const dir = await mkdtemp(join(tmpdir(), "opensona-verify-"));
    try {
      await writeBundle(dir, mkManifest(), bundleNodes, bundleEdges, bundleAliases);
      const cases: GraphVerifyCase[] = [
        {
          id: "no-alias",
          query: "q",
          layer: "alias",
          characterContext: { id: "a", bio: "" },
        },
      ];
      const report = await verifyBundle(dir, cases);
      expect(report.cases[0].passed).toBe(false);
      expect(report.cases[0].failures.some((f) => f.includes("no `alias` or `aliases`"))).toBe(
        true,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("expectEmpty fails and reports count when retrieval returns chunks", async () => {
    const dir = await mkdtemp(join(tmpdir(), "opensona-verify-"));
    try {
      await writeBundle(dir, mkManifest(), bundleNodes, bundleEdges, bundleAliases);
      const cases: GraphVerifyCase[] = [
        {
          id: "expect-empty-fail",
          query: "q",
          layer: "alias",
          alias: "alpha",
          neighbors: "none",
          characterContext: { id: "a", bio: "" },
          expectEmpty: true,
        },
      ];
      const report = await verifyBundle(dir, cases);
      expect(report.cases[0].passed).toBe(false);
      expect(report.cases[0].failures.some((f) => f.includes("expected empty"))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("invokes onProgress once per case with (i+1, total)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "opensona-verify-"));
    try {
      await writeBundle(dir, mkManifest(), bundleNodes, bundleEdges, bundleAliases);
      const cases: GraphVerifyCase[] = [
        {
          id: "c1",
          query: "q",
          layer: "alias",
          alias: "alpha",
          neighbors: "none",
          characterContext: { id: "a", bio: "" },
        },
        {
          id: "c2",
          query: "q",
          layer: "alias",
          alias: "bravo",
          neighbors: "none",
          characterContext: { id: "b", bio: "" },
        },
      ];
      const events: Array<[number, number]> = [];
      await verifyBundle(dir, cases, (done, total) => events.push([done, total]));
      expect(events).toEqual([
        [1, 2],
        [2, 2],
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
