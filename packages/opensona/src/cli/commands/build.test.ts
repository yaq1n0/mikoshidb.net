import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn(),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../build/parse.ts", () => ({
  parseDump: vi.fn(),
}));
vi.mock("../../build/chunk.ts", () => ({
  chunkArticles: vi.fn(),
}));
vi.mock("../../build/embed.ts", () => ({
  embedChunks: vi.fn(),
}));
vi.mock("../../build/pack.ts", () => ({
  packBundle: vi.fn(),
}));
vi.mock("../../config.ts", () => ({
  loadConfig: vi.fn(),
}));

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { parseDump } from "../../build/parse.ts";
import { chunkArticles } from "../../build/chunk.ts";
import { embedChunks } from "../../build/embed.ts";
import { packBundle } from "../../build/pack.ts";
import { loadConfig } from "../../config.ts";
import { run } from "./build.ts";

const parseDumpMock = parseDump as unknown as ReturnType<typeof vi.fn>;
const chunkArticlesMock = chunkArticles as unknown as ReturnType<typeof vi.fn>;
const embedChunksMock = embedChunks as unknown as ReturnType<typeof vi.fn>;
const packBundleMock = packBundle as unknown as ReturnType<typeof vi.fn>;
const loadConfigMock = loadConfig as unknown as ReturnType<typeof vi.fn>;
const readFileMock = readFile as unknown as ReturnType<typeof vi.fn>;
const writeFileMock = writeFile as unknown as ReturnType<typeof vi.fn>;
const mkdirMock = mkdir as unknown as ReturnType<typeof vi.fn>;

function makeConfig() {
  return {
    dumpPath: "/tmp/dump.xml",
    generatedDir: "/tmp/generated",
    embedder: { model: "mock-model", dim: 8, batchSize: 4 },
  };
}

describe("build run()", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    parseDumpMock.mockReset();
    chunkArticlesMock.mockReset();
    embedChunksMock.mockReset();
    packBundleMock.mockReset();
    loadConfigMock.mockReset();
    readFileMock.mockReset();
    writeFileMock.mockReset().mockResolvedValue(undefined);
    mkdirMock.mockReset().mockResolvedValue(undefined);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    logSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  it("--limit 5 slices articles and feeds chunker/embedder with the reduced set", async () => {
    loadConfigMock.mockResolvedValue(makeConfig());
    // timeline.json, category-map.json
    readFileMock
      .mockResolvedValueOnce(JSON.stringify({ events: [] }))
      .mockResolvedValueOnce(JSON.stringify({ mapping: {}, skipped: [] }));

    // Return 10 articles — limit 5 should reduce to 5
    const articles = Array.from({ length: 10 }, (_, i) => ({ title: `A${i}` }));
    parseDumpMock.mockResolvedValue(articles);

    const chunks = Array.from({ length: 3 }, (_, i) => ({ id: `c${i}` }));
    chunkArticlesMock.mockReturnValue(chunks);
    embedChunksMock.mockResolvedValue({ vectors: new Float32Array(3 * 8), dim: 8 });
    packBundleMock.mockResolvedValue({
      manifest: {
        counts: { articles: 5, chunks: 3, events: 0 },
        embedder: { model: "mock-model", dim: 8 },
        buildDate: "2026-01-01",
      },
      files: [{ path: "manifest.json", data: Buffer.from("{}") }],
    });

    await run({ config: "cfg.json", output: "/tmp/out", limit: 5 });

    // chunkArticles called with the 5-item slice
    const chunkerArticlesArg = chunkArticlesMock.mock.calls[0][0];
    expect(chunkerArticlesArg).toHaveLength(5);

    // embedChunks called with our 3 chunks (the output of chunkArticles)
    const embedChunksArg = embedChunksMock.mock.calls[0][0];
    expect(embedChunksArg).toBe(chunks);

    // packBundle called with our chunks
    const packChunksArg = packBundleMock.mock.calls[0][0];
    expect(packChunksArg).toBe(chunks);
  });

  it("no --limit passes all articles through", async () => {
    loadConfigMock.mockResolvedValue(makeConfig());
    readFileMock
      .mockResolvedValueOnce(JSON.stringify({ events: [] }))
      .mockResolvedValueOnce(JSON.stringify({ mapping: {}, skipped: [] }));

    const articles = Array.from({ length: 7 }, (_, i) => ({ title: `A${i}` }));
    parseDumpMock.mockResolvedValue(articles);
    chunkArticlesMock.mockReturnValue([]);
    embedChunksMock.mockResolvedValue({ vectors: new Float32Array(0), dim: 8 });
    packBundleMock.mockResolvedValue({
      manifest: {
        counts: { articles: 7, chunks: 0, events: 0 },
        embedder: { model: "mock-model", dim: 8 },
        buildDate: "2026-01-01",
      },
      files: [],
    });

    await run({ config: "cfg.json", output: "/tmp/out" });

    expect(chunkArticlesMock.mock.calls[0][0]).toHaveLength(7);
  });

  it("writes each packBundle output file to disk under opts.output", async () => {
    loadConfigMock.mockResolvedValue(makeConfig());
    readFileMock
      .mockResolvedValueOnce(JSON.stringify({ events: [] }))
      .mockResolvedValueOnce(JSON.stringify({ mapping: {}, skipped: [] }));
    parseDumpMock.mockResolvedValue([]);
    chunkArticlesMock.mockReturnValue([]);
    embedChunksMock.mockResolvedValue({ vectors: new Float32Array(0), dim: 8 });

    const files = [
      { path: "manifest.json", data: Buffer.from("m") },
      { path: "chunks.json.gz", data: Buffer.from("c") },
      { path: "embeddings.bin", data: Buffer.from("e") },
    ];
    packBundleMock.mockResolvedValue({
      manifest: {
        counts: { articles: 0, chunks: 0, events: 0 },
        embedder: { model: "mock-model", dim: 8 },
        buildDate: "2026-01-01",
      },
      files,
    });

    await run({ config: "cfg.json", output: "/tmp/out" });

    expect(mkdirMock).toHaveBeenCalledWith("/tmp/out", { recursive: true });
    expect(writeFileMock).toHaveBeenCalledTimes(3);
    const writtenPaths = writeFileMock.mock.calls.map((c) => c[0]);
    expect(writtenPaths).toContain("/tmp/out/manifest.json");
    expect(writtenPaths).toContain("/tmp/out/chunks.json.gz");
    expect(writtenPaths).toContain("/tmp/out/embeddings.bin");
  });

  it("exercises the embed progress callback", async () => {
    loadConfigMock.mockResolvedValue(makeConfig());
    readFileMock
      .mockResolvedValueOnce(JSON.stringify({ events: [] }))
      .mockResolvedValueOnce(JSON.stringify({ mapping: {}, skipped: [] }));
    parseDumpMock.mockResolvedValue([]);
    chunkArticlesMock.mockReturnValue([]);
    embedChunksMock.mockImplementation(async (_chunks, _cfg, onProgress) => {
      onProgress?.(1, 2);
      onProgress?.(2, 2);
      return { vectors: new Float32Array(0), dim: 8 };
    });
    packBundleMock.mockResolvedValue({
      manifest: {
        counts: { articles: 0, chunks: 0, events: 0 },
        embedder: { model: "mock-model", dim: 8 },
        buildDate: "2026-01-01",
      },
      files: [],
    });

    await run({ config: "cfg.json", output: "/tmp/out" });

    expect(stdoutSpy).toHaveBeenCalled();
  });
});
