import { describe, it, expect } from "vitest";
import { gzipSync } from "node:zlib";
import type { Manifest, TraversalDirective } from "../types.ts";
import { createRuntime } from "./index.ts";

let bundleCounter = 0;
const nextBundlePath = (): string => `rt-bundle-${++bundleCounter}/`;

const mkManifest = (): Manifest => ({
  version: 2,
  retrieval: "graph",
  buildDate: "2026-01-01T00:00:00.000Z",
  source: "https://example.fandom.com",
  license: "CC-BY-SA",
  graph: { sectionMaxChars: 2000, leadMaxChars: 600, deadLinkCount: 0 },
  counts: { articles: 1, sections: 0, categories: 0, aliases: 1, edges: 0, events: 0 },
  timeline: { events: [] },
  timelineMeta: { articleTitle: "Timeline", eventCount: 0, minYear: 0, maxYear: 0 },
  files: {
    nodes: { path: "graph-nodes.json.gz", sizeBytes: 1, sha256: "a".repeat(64) },
    edges: { path: "graph-edges.json.gz", sizeBytes: 1, sha256: "b".repeat(64) },
    aliases: { path: "aliases.json.gz", sizeBytes: 1, sha256: "c".repeat(64) },
  },
});

const gzJson = (value: unknown): BodyInit => {
  const buf = gzipSync(Buffer.from(JSON.stringify(value), "utf-8"));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
};

const nodesPayload = {
  articles: [
    {
      kind: "article",
      id: "a",
      title: "Alpha",
      categories: [],
      eventIds: [],
      latestEventOrder: -1,
      tags: [],
      lead: "Alpha lead.",
      sectionIds: [],
    },
  ],
  sections: [],
  categories: [],
};
const edgesPayload = { links: {}, contains: {}, inCategory: {}, inEvent: {}, mentions: {} };
const aliasesPayload = { alpha: "a" };

const makeOverride = (manifest: Manifest) => async (url: string) => {
  if (url.endsWith("manifest.json")) {
    return new Response(JSON.stringify(manifest), { status: 200 });
  }
  if (url.endsWith("graph-nodes.json.gz")) return new Response(gzJson(nodesPayload), { status: 200 });
  if (url.endsWith("graph-edges.json.gz")) return new Response(gzJson(edgesPayload), { status: 200 });
  if (url.endsWith("aliases.json.gz")) return new Response(gzJson(aliasesPayload), { status: 200 });
  return new Response("", { status: 404 });
};

describe("createRuntime()", () => {
  it("query throws 'Runtime not loaded.' when called before load", async () => {
    const rt = createRuntime();
    await expect(
      rt.query("?", {
        characterContext: { id: "a", bio: "" },
        getTraversalPath: async () => null,
      }),
    ).rejects.toThrow(/Runtime not loaded/);
  });

  it("warmEngram throws 'Runtime not loaded.' before load", () => {
    const rt = createRuntime();
    expect(() => rt.warmEngram("a")).toThrow(/Runtime not loaded/);
  });

  it("manifest() returns null before load and the loaded manifest after", async () => {
    const rt = createRuntime();
    expect(rt.manifest()).toBeNull();
    await rt.load(nextBundlePath(), { fetchOverride: makeOverride(mkManifest()) });
    expect(rt.manifest()?.version).toBe(2);
  });

  it("query happy path: stub resolver → chunks + onTrace fires with directive", async () => {
    const rt = createRuntime();
    await rt.load(nextBundlePath(), { fetchOverride: makeOverride(mkManifest()) });
    const directive: TraversalDirective = {
      entities: ["alpha"],
      neighbors: "none",
      include_categories: [],
    };
    let seenDirective: TraversalDirective | null = null;
    const chunks = await rt.query("Who is Alpha?", {
      characterContext: { id: "a", bio: "" },
      getTraversalPath: async () => directive,
      onTrace: (_trace, dir) => {
        seenDirective = dir;
      },
    });
    expect(chunks.length).toBeGreaterThan(0);
    expect(seenDirective).toBe(directive);
  });

  it("query returns [] and skips onTrace when resolver yields null", async () => {
    const rt = createRuntime();
    await rt.load(nextBundlePath(), { fetchOverride: makeOverride(mkManifest()) });
    let traced = false;
    const chunks = await rt.query("?", {
      characterContext: { id: "a", bio: "" },
      getTraversalPath: async () => null,
      onTrace: () => {
        traced = true;
      },
    });
    expect(chunks).toEqual([]);
    expect(traced).toBe(false);
  });

  it("query returns [] and skips onTrace when resolver throws", async () => {
    const rt = createRuntime();
    await rt.load(nextBundlePath(), { fetchOverride: makeOverride(mkManifest()) });
    let traced = false;
    const chunks = await rt.query("?", {
      characterContext: { id: "a", bio: "" },
      getTraversalPath: async () => {
        throw new Error("boom");
      },
      onTrace: () => {
        traced = true;
      },
    });
    expect(chunks).toEqual([]);
    expect(traced).toBe(false);
  });

  it("query returns [] when directive.entities is empty", async () => {
    const rt = createRuntime();
    await rt.load(nextBundlePath(), { fetchOverride: makeOverride(mkManifest()) });
    const chunks = await rt.query("?", {
      characterContext: { id: "a", bio: "" },
      getTraversalPath: async () => ({
        entities: [],
        neighbors: "none",
        include_categories: [],
      }),
    });
    expect(chunks).toEqual([]);
  });

  it("warmEngram memoizes per engram id; load() clears the cache", async () => {
    const rt = createRuntime();
    const path = nextBundlePath();
    await rt.load(path, { fetchOverride: makeOverride(mkManifest()) });
    const v1 = rt.warmEngram("a");
    const v2 = rt.warmEngram("a");
    expect(v1).toBe(v2);
    await rt.load(path, { fetchOverride: makeOverride(mkManifest()) });
    const v3 = rt.warmEngram("a");
    expect(v3).not.toBe(v1);
  });
});
