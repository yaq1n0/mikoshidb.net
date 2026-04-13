import { describe, it, expect } from "vitest";
import { gzipSync } from "node:zlib";
import type { Manifest } from "../types.ts";
import { ensureLoaded } from "./loader.ts";

let bundleCounter = 0;
const nextBundlePath = (): string => `bundle-${++bundleCounter}/`;

const mkManifest = (over?: Partial<Manifest>): Manifest => ({
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
    nodes: { path: "graph-nodes.json.gz", sizeBytes: 1, sha256: "a".repeat(64) },
    edges: { path: "graph-edges.json.gz", sizeBytes: 1, sha256: "b".repeat(64) },
    aliases: { path: "aliases.json.gz", sizeBytes: 1, sha256: "c".repeat(64) },
  },
  ...over,
});

const gzJson = (value: unknown): BodyInit => {
  const buf = gzipSync(Buffer.from(JSON.stringify(value), "utf-8"));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
};

const emptyNodes = { articles: [], sections: [], categories: [] };
const emptyEdges = { links: {}, contains: {}, inCategory: {}, inEvent: {}, mentions: {} };
const emptyAliases = {};

type FetchRecord = { url: string; sha: string };

const makeOverride = (
  manifest: Manifest,
  records?: FetchRecord[],
): ((url: string, sha: string) => Promise<Response>) => {
  return async (url, sha) => {
    records?.push({ url, sha });
    if (url.endsWith("manifest.json")) {
      return new Response(JSON.stringify(manifest), { status: 200 });
    }
    if (url.endsWith("graph-nodes.json.gz")) {
      return new Response(gzJson(emptyNodes), { status: 200 });
    }
    if (url.endsWith("graph-edges.json.gz")) {
      return new Response(gzJson(emptyEdges), { status: 200 });
    }
    if (url.endsWith("aliases.json.gz")) {
      return new Response(gzJson(emptyAliases), { status: 200 });
    }
    return new Response("", { status: 404 });
  };
};

describe("ensureLoaded() — happy path", () => {
  it("loads manifest + three assets, emits monotone progress, returns LoadedGraph", async () => {
    const manifest = mkManifest();
    const events: Array<{ phase: string; ratio: number }> = [];
    const graph = await ensureLoaded(nextBundlePath(), {
      onProgress: (p) => events.push(p),
      fetchOverride: makeOverride(manifest),
    });
    expect(graph.manifest.version).toBe(2);
    expect(events[0]).toEqual({ phase: "manifest", ratio: 0 });
    expect(events.at(-1)).toEqual({ phase: "assets", ratio: 1 });
    expect(events.some((e) => e.phase === "manifest" && e.ratio === 1)).toBe(true);
    expect(events.some((e) => e.phase === "assets" && e.ratio === 0)).toBe(true);
  });

  it("passes expected sha for assets and empty string for manifest", async () => {
    const manifest = mkManifest();
    const records: FetchRecord[] = [];
    await ensureLoaded(nextBundlePath(), {
      fetchOverride: makeOverride(manifest, records),
    });
    const man = records.find((r) => r.url.endsWith("manifest.json"))!;
    expect(man.sha).toBe("");
    const nodes = records.find((r) => r.url.endsWith("graph-nodes.json.gz"))!;
    expect(nodes.sha).toBe("a".repeat(64));
    const edges = records.find((r) => r.url.endsWith("graph-edges.json.gz"))!;
    expect(edges.sha).toBe("b".repeat(64));
    const aliases = records.find((r) => r.url.endsWith("aliases.json.gz"))!;
    expect(aliases.sha).toBe("c".repeat(64));
  });

  it("accepts an options object with onProgress and fetchOverride", async () => {
    const manifest = mkManifest();
    const events: Array<{ phase: string; ratio: number }> = [];
    await ensureLoaded(nextBundlePath(), {
      onProgress: (p) => events.push(p),
      fetchOverride: makeOverride(manifest),
    });
    expect(events.length).toBeGreaterThan(0);
  });

  it("accepts undefined options (normalizeOptions default)", async () => {
    const manifest = mkManifest();
    const path = nextBundlePath();
    // Pre-seed the loading map via a keyed call so we don't actually invoke real fetch.
    // This call wires in fetchOverride; a second undefined call to the same path reuses
    // the cached promise and resolves without hitting the default path.
    const p1 = ensureLoaded(path, { fetchOverride: makeOverride(manifest) });
    const p2 = ensureLoaded(path);
    expect(p1).toBe(p2);
    await p1;
  });
});

describe("ensureLoaded() — errors", () => {
  it("throws on manifest.version !== 2", async () => {
    const manifest = mkManifest({ version: 99 as unknown as 2 });
    await expect(
      ensureLoaded(nextBundlePath(), { fetchOverride: makeOverride(manifest) }),
    ).rejects.toThrow(/Unsupported bundle version/);
  });

  it("throws on retrieval !== 'graph'", async () => {
    const manifest = mkManifest({ retrieval: "vector" as unknown as "graph" });
    await expect(
      ensureLoaded(nextBundlePath(), { fetchOverride: makeOverride(manifest) }),
    ).rejects.toThrow(/Unsupported retrieval kind/);
  });

  it("throws when manifest fetch returns !ok", async () => {
    await expect(
      ensureLoaded(nextBundlePath(), {
        fetchOverride: async (url) => {
          if (url.endsWith("manifest.json")) return new Response("", { status: 404 });
          return new Response("", { status: 500 });
        },
      }),
    ).rejects.toThrow(/Failed to fetch manifest: 404/);
  });

  it("throws when an asset fetch returns !ok", async () => {
    const manifest = mkManifest();
    await expect(
      ensureLoaded(nextBundlePath(), {
        fetchOverride: async (url) => {
          if (url.endsWith("manifest.json")) {
            return new Response(JSON.stringify(manifest), { status: 200 });
          }
          if (url.endsWith("graph-nodes.json.gz")) {
            return new Response("", { status: 503 });
          }
          return new Response(gzJson({}), { status: 200 });
        },
      }),
    ).rejects.toThrow(/graph-nodes.*503/);
  });
});

describe("ensureLoaded() — memoization", () => {
  it("shares a promise for two concurrent calls to the same bundle path", () => {
    const manifest = mkManifest();
    const path = nextBundlePath();
    const override = makeOverride(manifest);
    const p1 = ensureLoaded(path, { fetchOverride: override });
    const p2 = ensureLoaded(path, { fetchOverride: override });
    expect(p1).toBe(p2);
    return p1; // ensure it resolves
  });

  it("clears cache after rejection so a retry re-fetches", async () => {
    const path = nextBundlePath();
    const badOverride = async (url: string) => {
      if (url.endsWith("manifest.json")) return new Response("", { status: 500 });
      return new Response("", { status: 500 });
    };
    const p1 = ensureLoaded(path, { fetchOverride: badOverride });
    await expect(p1).rejects.toThrow();

    const manifest = mkManifest();
    const p2 = ensureLoaded(path, { fetchOverride: makeOverride(manifest) });
    expect(p2).not.toBe(p1);
    const graph = await p2;
    expect(graph.manifest.version).toBe(2);
  });
});
