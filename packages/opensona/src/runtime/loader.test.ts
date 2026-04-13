import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { packBundle } from "../build/pack.ts";
import type { Chunk, OpensonaConfig, Timeline } from "../types.ts";
import { ensureLoaded } from "./loader.ts";

/** Counter used to generate unique bundle paths per test so the module-level
 * loading-cache in loader.ts doesn't bleed state across cases. */
let pathCounter = 0;
function uniqueBundlePath(): string {
  pathCounter += 1;
  return `https://bundle-test-${pathCounter}/`;
}

/**
 * Minimal test config for packBundle. Skips fields the packer doesn't touch
 * when wrapped in `as OpensonaConfig`.
 */
const TEST_CONFIG: OpensonaConfig = {
  dumpPath: "./dump.xml",
  generatedDir: "./gen",
  source: "https://example.com/wiki",
  license: "CC-BY-SA",
  embedder: {
    model: "test/embedder",
    dim: 4,
    batchSize: 8,
  },
  chunking: { targetTokens: 100, maxTokens: 200, overlapTokens: 10 },
  maxBundleBytes: 10 * 1024 * 1024,
  bm25: {
    fields: ["title", "header", "text"],
    boosts: { title: 3, header: 2, text: 1 },
  },
  timelineArticleTitle: "Timeline",
  timelineValidation: { minYearHeadings: 0, minEvents: 0 },
  editionEras: [],
  categorySkip: { prefixes: [], suffixes: [], exact: [] },
};

function makeTestChunks(): Chunk[] {
  return [
    {
      id: "a#0",
      articleId: "a",
      title: "Alpha",
      header: "[Alpha]",
      text: "Alpha data",
      eventIds: [],
      latestEventOrder: -1,
      tags: [],
      categories: [],
    },
    {
      id: "b#0",
      articleId: "b",
      title: "Beta",
      header: "[Beta]",
      text: "Beta data",
      eventIds: [],
      latestEventOrder: -1,
      tags: [],
      categories: [],
    },
  ];
}

function makeTestVectors(count: number, dim: number): Float32Array {
  const vec = new Float32Array(count * dim);
  for (let i = 0; i < count; i++) {
    vec[i * dim + (i % dim)] = 1.0;
  }
  return vec;
}

interface BuiltBundle {
  filesByName: Map<string, Buffer>;
  chunks: Chunk[];
  dim: number;
}

async function buildBundle(): Promise<BuiltBundle> {
  const chunks = makeTestChunks();
  const dim = TEST_CONFIG.embedder.dim;
  const vectors = makeTestVectors(chunks.length, dim);
  const timeline: Timeline = { events: [] };
  const { files } = await packBundle(chunks, vectors, dim, timeline, TEST_CONFIG);

  const filesByName = new Map<string, Buffer>();
  for (const f of files) {
    filesByName.set(f.path, f.data);
  }
  return { filesByName, chunks, dim };
}

/** Build a Response-like object from a Buffer. */
function ok(buf: Buffer | Uint8Array): Response {
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return {
    ok: true,
    status: 200,
    async arrayBuffer() {
      return ab;
    },
    async json() {
      return JSON.parse(new TextDecoder().decode(ab));
    },
    async text() {
      return new TextDecoder().decode(ab);
    },
  } as unknown as Response;
}

function notFound(): Response {
  return {
    ok: false,
    status: 404,
    async arrayBuffer() {
      return new ArrayBuffer(0);
    },
    async json() {
      return {};
    },
    async text() {
      return "";
    },
  } as unknown as Response;
}

/** Install a fetch stub that serves files from a given BuiltBundle, keyed by
 * trailing filename, regardless of bundle prefix. Returns the spy so we can
 * assert call counts. */
function installFetchStub(
  bundle: BuiltBundle,
  overrides?: Partial<Record<string, () => Response>>,
): ReturnType<typeof vi.fn> {
  const spy = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const name = url.split("/").pop() ?? "";
    if (overrides && overrides[name]) {
      return overrides[name]!();
    }
    const data = bundle.filesByName.get(name);
    if (!data) return notFound();
    return ok(data);
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

describe("ensureLoaded()", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("happy path: resolves with count/dim/manifest from bundle", async () => {
    const built = await buildBundle();
    installFetchStub(built);
    const path = uniqueBundlePath();

    const bundle = await ensureLoaded(path);

    expect(bundle.count).toBe(built.chunks.length);
    expect(bundle.dim).toBe(built.dim);
    expect(bundle.manifest.version).toBe(1);
    expect(bundle.manifest.embedder.model).toBe(TEST_CONFIG.embedder.model);
    expect(bundle.chunks).toHaveLength(built.chunks.length);
    expect(bundle.scales).toBeInstanceOf(Float32Array);
    expect(bundle.scales.length).toBe(built.chunks.length);
    expect(bundle.quants).toBeInstanceOf(Int8Array);
    expect(bundle.quants.length).toBe(built.chunks.length * built.dim);
    // bm25 is a real MiniSearch instance with .search()
    expect(typeof bundle.bm25.search).toBe("function");
  });

  it("two concurrent ensureLoaded calls share one promise (fetch not duplicated)", async () => {
    const built = await buildBundle();
    const fetchSpy = installFetchStub(built);
    const path = uniqueBundlePath();

    const [a, b] = await Promise.all([ensureLoaded(path), ensureLoaded(path)]);
    expect(a).toBe(b);
    // 1 manifest + 3 asset fetches = 4 calls total (not 8).
    expect(fetchSpy).toHaveBeenCalledTimes(4);
  });

  it("failed manifest load rejects, cache entry is cleared, retry succeeds", async () => {
    const built = await buildBundle();
    const path = uniqueBundlePath();

    // First attempt: manifest returns 404.
    let failManifest = true;
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      const name = url.split("/").pop() ?? "";
      if (name === "manifest.json" && failManifest) return notFound();
      const data = built.filesByName.get(name);
      if (!data) return notFound();
      return ok(data);
    });
    vi.stubGlobal("fetch", fetchSpy);

    await expect(ensureLoaded(path)).rejects.toThrow(/Failed to fetch manifest/);

    // Flip the failure switch and retry — should now succeed (cache entry was cleared).
    failManifest = false;
    const bundle = await ensureLoaded(path);
    expect(bundle.manifest.version).toBe(1);
  });

  it("rejects bundles with unsupported version", async () => {
    const built = await buildBundle();
    // Replace the manifest with a version:2 variant.
    const manifestText = new TextDecoder().decode(built.filesByName.get("manifest.json")!);
    const manifestObj = JSON.parse(manifestText);
    manifestObj.version = 2;
    const newManifest = Buffer.from(JSON.stringify(manifestObj, null, 2) + "\n", "utf-8");
    built.filesByName.set("manifest.json", newManifest);

    installFetchStub(built);
    const path = uniqueBundlePath();
    await expect(ensureLoaded(path)).rejects.toThrow(/Unsupported bundle version/);
  });

  it("rejects bundles missing embedder.model", async () => {
    const built = await buildBundle();
    const manifestText = new TextDecoder().decode(built.filesByName.get("manifest.json")!);
    const manifestObj = JSON.parse(manifestText);
    manifestObj.embedder.model = "";
    const newManifest = Buffer.from(JSON.stringify(manifestObj, null, 2) + "\n", "utf-8");
    built.filesByName.set("manifest.json", newManifest);

    installFetchStub(built);
    const path = uniqueBundlePath();
    await expect(ensureLoaded(path)).rejects.toThrow(/missing embedder\.model/);
  });

  it("parseEmbeddings produces Float32Array scales + Int8Array quants of correct length", async () => {
    const built = await buildBundle();
    installFetchStub(built);
    const path = uniqueBundlePath();

    const bundle = await ensureLoaded(path);
    expect(bundle.scales).toBeInstanceOf(Float32Array);
    expect(bundle.quants).toBeInstanceOf(Int8Array);
    expect(bundle.scales.length).toBe(bundle.count);
    expect(bundle.quants.length).toBe(bundle.count * bundle.dim);
  });

  it("fires onProgress with 'manifest' then 'assets' phases", async () => {
    const built = await buildBundle();
    installFetchStub(built);
    const path = uniqueBundlePath();

    const events: { phase: string; ratio: number }[] = [];
    await ensureLoaded(path, (p) => {
      events.push(p);
    });

    const phases = events.map((e) => e.phase);
    expect(phases).toContain("manifest");
    expect(phases).toContain("assets");
    // Manifest phase should be observed before the first assets phase.
    const firstManifestIdx = phases.indexOf("manifest");
    const firstAssetsIdx = phases.indexOf("assets");
    expect(firstManifestIdx).toBeLessThan(firstAssetsIdx);
    // Final assets progress should be ratio 1.
    const lastAssets = [...events].reverse().find((e) => e.phase === "assets");
    expect(lastAssets?.ratio).toBe(1);
  });

  it("accepts bundle paths with or without trailing slash", async () => {
    const built = await buildBundle();
    installFetchStub(built);
    const path = `https://bundle-test-noslash-${pathCounter++}`;

    const bundle = await ensureLoaded(path);
    expect(bundle.manifest.version).toBe(1);
  });

  it("rejects when chunks.json.gz fetch fails", async () => {
    const built = await buildBundle();
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      const name = url.split("/").pop() ?? "";
      if (name === "chunks.json.gz") return notFound();
      const data = built.filesByName.get(name);
      if (!data) return notFound();
      return ok(data);
    });
    vi.stubGlobal("fetch", fetchSpy);
    const path = uniqueBundlePath();
    await expect(ensureLoaded(path)).rejects.toThrow(/Failed to fetch chunks/);
  });

  it("rejects when embeddings.i8.bin fetch fails", async () => {
    const built = await buildBundle();
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      const name = url.split("/").pop() ?? "";
      if (name === "embeddings.i8.bin") return notFound();
      const data = built.filesByName.get(name);
      if (!data) return notFound();
      return ok(data);
    });
    vi.stubGlobal("fetch", fetchSpy);
    const path = uniqueBundlePath();
    await expect(ensureLoaded(path)).rejects.toThrow(/Failed to fetch embeddings/);
  });

  it("rejects when bm25.json.gz fetch fails", async () => {
    const built = await buildBundle();
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      const name = url.split("/").pop() ?? "";
      if (name === "bm25.json.gz") return notFound();
      const data = built.filesByName.get(name);
      if (!data) return notFound();
      return ok(data);
    });
    vi.stubGlobal("fetch", fetchSpy);
    const path = uniqueBundlePath();
    await expect(ensureLoaded(path)).rejects.toThrow(/Failed to fetch bm25/);
  });

  it("fetchOverride: invoked with url + expected sha256 per asset; legacy positional onProgress still works", async () => {
    const built = await buildBundle();
    // Stub global fetch to ensure it is NOT used when fetchOverride is set.
    const fetchSpy = vi.fn(async () => notFound());
    vi.stubGlobal("fetch", fetchSpy);

    // Resolve the manifest first so we can assert sha256s passed to override.
    const manifestBuf = built.filesByName.get("manifest.json")!;
    const manifestObj = JSON.parse(new TextDecoder().decode(manifestBuf));
    const expectedShas: Record<string, string> = {
      "manifest.json": "", // manifest itself has no pre-known sha; loader passes ""
      "chunks.json.gz": manifestObj.files.chunks.sha256,
      "embeddings.i8.bin": manifestObj.files.embeddings.sha256,
      "bm25.json.gz": manifestObj.files.bm25.sha256,
    };

    const overrideCalls: { url: string; sha: string }[] = [];
    const fetchOverride = vi.fn(async (url: string, expectedSha256: string) => {
      overrideCalls.push({ url, sha: expectedSha256 });
      const name = url.split("/").pop() ?? "";
      const data = built.filesByName.get(name);
      if (!data) return notFound();
      return ok(data);
    });

    const path = uniqueBundlePath();
    const bundle = await ensureLoaded(path, { fetchOverride });

    // Override drives downstream parsing — verify it was used.
    expect(bundle.manifest.version).toBe(1);
    expect(bundle.count).toBe(built.chunks.length);
    // Global fetch must not have been called when override is provided.
    expect(fetchSpy).not.toHaveBeenCalled();
    // One call per asset (manifest + 3 files).
    expect(fetchOverride).toHaveBeenCalledTimes(4);
    // Each call's (url, sha) matches the manifest.
    for (const { url, sha } of overrideCalls) {
      const name = url.split("/").pop() ?? "";
      expect(sha).toBe(expectedShas[name]);
    }

    // Legacy positional onProgress: passing a bare function as the 2nd arg
    // must still fire progress callbacks, with no override / no bag.
    vi.unstubAllGlobals();
    installFetchStub(built);
    const events: { phase: string; ratio: number }[] = [];
    await ensureLoaded(uniqueBundlePath(), (p) => events.push(p));
    expect(events.some((e) => e.phase === "manifest")).toBe(true);
    expect(events.some((e) => e.phase === "assets" && e.ratio === 1)).toBe(true);
  });
});
