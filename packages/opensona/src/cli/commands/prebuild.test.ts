import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CliError } from "../errors.ts";

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../build/parse.ts", () => ({
  parseDump: vi.fn(),
}));
vi.mock("../../build/timeline.ts", () => ({
  generateTimeline: vi.fn(),
}));
vi.mock("../../config.ts", () => ({
  loadConfig: vi.fn(),
}));

import { mkdir, writeFile } from "node:fs/promises";
import { parseDump } from "../../build/parse.ts";
import { generateTimeline } from "../../build/timeline.ts";
import { loadConfig } from "../../config.ts";
import { run } from "./prebuild.ts";

const parseDumpMock = parseDump as unknown as ReturnType<typeof vi.fn>;
const generateTimelineMock = generateTimeline as unknown as ReturnType<typeof vi.fn>;
const loadConfigMock = loadConfig as unknown as ReturnType<typeof vi.fn>;
const mkdirMock = mkdir as unknown as ReturnType<typeof vi.fn>;
const writeFileMock = writeFile as unknown as ReturnType<typeof vi.fn>;

function makeConfig(overrides: Record<string, unknown> = {}) {
  return {
    dumpPath: "/tmp/dump.xml",
    generatedDir: "/tmp/generated",
    timelineArticleTitle: "Timeline",
    editionEras: [],
    ...overrides,
  };
}

describe("prebuild run()", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    parseDumpMock.mockReset();
    generateTimelineMock.mockReset();
    loadConfigMock.mockReset();
    mkdirMock.mockReset().mockResolvedValue(undefined);
    writeFileMock.mockReset().mockResolvedValue(undefined);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("throws CliError when the timeline article is missing from the dump", async () => {
    loadConfigMock.mockResolvedValue(makeConfig());
    parseDumpMock.mockResolvedValue({
      articles: [{ title: "SomethingElse", sections: [] }],
      redirects: [],
    });

    await expect(run({ config: "cfg.json", output: "/tmp/out" })).rejects.toThrow(CliError);
    await expect(run({ config: "cfg.json", output: "/tmp/out" })).rejects.toThrow(/Timeline/);
  });

  it("logs era breakdown when editionEras.length > 0", async () => {
    loadConfigMock.mockResolvedValue(
      makeConfig({
        editionEras: [
          { prefix: "P1", label: "Era A", startYear: 2000, endYear: 2010 },
          { prefix: "P2", label: "Era B", startYear: 2011, endYear: 2020 },
        ],
      }),
    );

    parseDumpMock.mockResolvedValue({
      articles: [{ title: "Timeline", sections: [] }],
      redirects: [],
    });
    generateTimelineMock.mockReturnValue({
      events: [
        { id: "e1", name: "X", year: 2005, order: 1 },
        { id: "e2", name: "Y", year: 2015, order: 2 },
        { id: "e3", name: "Z", year: 2030, order: 3 }, // outside any era
      ],
    });

    await run({ config: "cfg.json", output: "/tmp/out" });

    const allLogs = logSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
    expect(allLogs).toContain("--- Era breakdown ---");
    expect(allLogs).toContain("Era A");
    expect(allLogs).toContain("Era B");
    expect(allLogs).toContain("Other years");
  });

  it("writes timeline.json to opts.output and does not write category-map.json", async () => {
    loadConfigMock.mockResolvedValue(makeConfig());
    parseDumpMock.mockResolvedValue({
      articles: [{ title: "Timeline", sections: [] }],
      redirects: [],
    });
    generateTimelineMock.mockReturnValue({ events: [] });

    await run({ config: "cfg.json", output: "/tmp/out" });

    expect(mkdirMock).toHaveBeenCalledWith("/tmp/out", { recursive: true });
    const writtenPaths = writeFileMock.mock.calls.map((c) => c[0]);
    expect(writtenPaths).toContain("/tmp/out/timeline.json");
    expect(writtenPaths).not.toContain("/tmp/out/category-map.json");
  });

  it("matches timeline article case-insensitively", async () => {
    loadConfigMock.mockResolvedValue(makeConfig({ timelineArticleTitle: "Timeline" }));
    parseDumpMock.mockResolvedValue({
      articles: [{ title: "timeline", sections: [] }],
      redirects: [],
    });
    generateTimelineMock.mockReturnValue({ events: [] });

    await expect(run({ config: "cfg.json", output: "/tmp/out" })).resolves.toBeUndefined();
    expect(generateTimelineMock).toHaveBeenCalled();
  });
});
