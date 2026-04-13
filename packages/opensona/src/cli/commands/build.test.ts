import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CliError } from "../errors.ts";

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn(),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../build/parse.ts", () => ({ parseDump: vi.fn() }));
vi.mock("../../build/graph.ts", () => ({ buildGraph: vi.fn() }));
vi.mock("../../build/pack-graph.ts", () => ({ packGraph: vi.fn() }));
vi.mock("../../build/prebuild-categories.ts", () => ({ generateCategoryEventMap: vi.fn() }));
vi.mock("../../config.ts", () => ({ loadConfig: vi.fn() }));

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { parseDump } from "../../build/parse.ts";
import { buildGraph } from "../../build/graph.ts";
import { packGraph } from "../../build/pack-graph.ts";
import { generateCategoryEventMap } from "../../build/prebuild-categories.ts";
import { loadConfig } from "../../config.ts";
import { run } from "./build.ts";

const readFileMock = readFile as unknown as ReturnType<typeof vi.fn>;
const writeFileMock = writeFile as unknown as ReturnType<typeof vi.fn>;
const mkdirMock = mkdir as unknown as ReturnType<typeof vi.fn>;
const parseDumpMock = parseDump as unknown as ReturnType<typeof vi.fn>;
const buildGraphMock = buildGraph as unknown as ReturnType<typeof vi.fn>;
const packGraphMock = packGraph as unknown as ReturnType<typeof vi.fn>;
const generateCategoryEventMapMock = generateCategoryEventMap as unknown as ReturnType<
  typeof vi.fn
>;
const loadConfigMock = loadConfig as unknown as ReturnType<typeof vi.fn>;

const mkConfig = () => ({
  dumpPath: "/tmp/dump.xml",
  generatedDir: "/tmp/generated",
  timelineArticleTitle: "Timeline",
  source: "https://example.fandom.com",
  license: "L",
  graph: {
    sectionMaxChars: 2000,
    leadMaxChars: 600,
    dropDeadLinks: true,
    includeMentionsEdges: false,
  },
  maxBundleBytes: 50_000_000,
  timelineValidation: { minYearHeadings: 0, minEvents: 0 },
  editionEras: [],
  categorySkip: { prefixes: [], suffixes: [], exact: [] },
});

const mkArticles = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    title: `A${i}`,
    slug: `a${i}`,
    sections: [],
    categories: [],
    links: [],
    infobox: {},
  }));

const mkGraph = () => ({
  nodes: { articles: new Map(), sections: new Map(), categories: new Map(), events: new Map() },
  edges: {
    links: new Map(),
    contains: new Map(),
    inCategory: new Map(),
    inEvent: new Map(),
    mentions: new Map(),
  },
  aliases: new Map(),
  deadLinkCount: 0,
});

const mkPackResult = () => ({
  manifest: {
    version: 2,
    retrieval: "graph",
    buildDate: "2026-01-01T00:00:00.000Z",
    source: "s",
    license: "l",
    graph: { sectionMaxChars: 2000, leadMaxChars: 600, deadLinkCount: 0 },
    counts: { articles: 0, sections: 0, categories: 0, aliases: 0, edges: 0, events: 0 },
    timeline: { events: [] },
    timelineMeta: { articleTitle: "Timeline", eventCount: 0, minYear: 0, maxYear: 0 },
    files: {
      nodes: { path: "graph-nodes.json.gz", sizeBytes: 0, sha256: "0".repeat(64) },
      edges: { path: "graph-edges.json.gz", sizeBytes: 0, sha256: "0".repeat(64) },
      aliases: { path: "aliases.json.gz", sizeBytes: 0, sha256: "0".repeat(64) },
    },
  },
  files: [
    { path: "graph-nodes.json.gz", data: new Uint8Array(10), meta: {} },
    { path: "graph-edges.json.gz", data: new Uint8Array(10), meta: {} },
    { path: "aliases.json.gz", data: new Uint8Array(10), meta: {} },
  ],
});

describe("build run()", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    readFileMock.mockReset();
    writeFileMock.mockReset().mockResolvedValue(undefined);
    mkdirMock.mockReset().mockResolvedValue(undefined);
    parseDumpMock.mockReset();
    buildGraphMock.mockReset();
    packGraphMock.mockReset();
    generateCategoryEventMapMock.mockReset();
    loadConfigMock.mockReset();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("happy path: writes manifest and asset files to the output directory", async () => {
    loadConfigMock.mockResolvedValue(mkConfig());
    readFileMock.mockResolvedValue(JSON.stringify({ events: [] }));
    parseDumpMock.mockResolvedValue({ articles: mkArticles(3), redirects: [] });
    generateCategoryEventMapMock.mockReturnValue({ mapping: {}, skipped: [] });
    buildGraphMock.mockReturnValue(mkGraph());
    packGraphMock.mockResolvedValue(mkPackResult());

    await run({ config: "cfg.json", output: "/tmp/out" });

    expect(mkdirMock).toHaveBeenCalledWith("/tmp/out", { recursive: true });
    const paths = writeFileMock.mock.calls.map((c) => c[0]);
    expect(paths).toContain("/tmp/out/manifest.json");
    expect(paths).toContain("/tmp/out/graph-nodes.json.gz");
    expect(paths).toContain("/tmp/out/graph-edges.json.gz");
    expect(paths).toContain("/tmp/out/aliases.json.gz");
  });

  it("honors --limit by slicing the article list", async () => {
    loadConfigMock.mockResolvedValue(mkConfig());
    readFileMock.mockResolvedValue(JSON.stringify({ events: [] }));
    parseDumpMock.mockResolvedValue({ articles: mkArticles(10), redirects: [] });
    generateCategoryEventMapMock.mockReturnValue({ mapping: {}, skipped: [] });
    buildGraphMock.mockReturnValue(mkGraph());
    packGraphMock.mockResolvedValue(mkPackResult());

    await run({ config: "cfg.json", output: "/tmp/out", limit: 3 });

    const articlesPassedToBuild = buildGraphMock.mock.calls[0][0];
    expect(articlesPassedToBuild).toHaveLength(3);
    const allLogs = logSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
    expect(allLogs).toContain("limited");
  });

  it("computes minYear/maxYear from timeline events in manifest meta", async () => {
    loadConfigMock.mockResolvedValue(mkConfig());
    readFileMock.mockResolvedValue(JSON.stringify({ events: [] }));
    parseDumpMock.mockResolvedValue({ articles: mkArticles(2), redirects: [] });
    generateCategoryEventMapMock.mockReturnValue({ mapping: {}, skipped: [] });
    buildGraphMock.mockReturnValue(mkGraph());
    const packArg = mkPackResult();
    packGraphMock.mockImplementation(async (_g, ctx) => {
      expect(ctx.timelineMeta.minYear).toBe(2020);
      expect(ctx.timelineMeta.maxYear).toBe(2077);
      expect(ctx.timelineMeta.eventCount).toBe(2);
      return packArg;
    });

    readFileMock.mockResolvedValueOnce(
      JSON.stringify({
        events: [
          { id: "e1", name: "A", year: 2020, order: 1 },
          { id: "e2", name: "B", year: 2077, order: 2 },
        ],
      }),
    );

    await run({ config: "cfg.json", output: "/tmp/out" });
    expect(packGraphMock).toHaveBeenCalled();
  });

  it("throws CliError when timeline.json is malformed", async () => {
    loadConfigMock.mockResolvedValue(mkConfig());
    readFileMock.mockResolvedValue("{not valid json");

    await expect(run({ config: "cfg.json", output: "/tmp/out" })).rejects.toThrow(CliError);
  });
});
