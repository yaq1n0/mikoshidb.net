import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CliError } from "../errors.ts";

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
}));

vi.mock("../../build/verify.ts", () => ({
  verifyBundle: vi.fn(),
}));

import { readFile } from "node:fs/promises";
import { verifyBundle } from "../../build/verify.ts";
import { run } from "./verify.ts";

const readFileMock = readFile as unknown as ReturnType<typeof vi.fn>;
const verifyBundleMock = verifyBundle as unknown as ReturnType<typeof vi.fn>;

const passingIntegrity = {
  articleCount: 0,
  sectionCount: 0,
  categoryCount: 0,
  aliasCount: 0,
  edgeCount: 0,
  dangling: {
    edgeSrc: [],
    edgeDst: [],
    aliasTarget: [],
    sectionArticle: [],
    categoryArticle: [],
    nodeEventIds: [],
  },
  passed: true,
};

describe("verify run()", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    readFileMock.mockReset();
    verifyBundleMock.mockReset();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    logSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  it("throws CliError when failCount > 0", async () => {
    readFileMock.mockResolvedValue(
      JSON.stringify([
        { id: "c1", query: "q1", cutoffEventId: "e1" },
        { id: "c2", query: "q2", cutoffEventId: "e1" },
      ]),
    );
    verifyBundleMock.mockResolvedValue({
      integrity: passingIntegrity,
      cases: [
        { id: "c1", layer: "alias", passed: true, allowedFailure: false, chunks: [], failures: [] },
        {
          id: "c2",
          layer: "alias",
          passed: false,
          allowedFailure: false,
          chunks: [{ id: "x", articleId: "x", header: "h", hops: 1 }],
          failures: ["missing thing"],
        },
      ],
      blocked: true,
    });

    await expect(run({ cases: "/tmp/cases.json", bundle: "/tmp/bundle" })).rejects.toThrow(
      CliError,
    );
    await expect(run({ cases: "/tmp/cases.json", bundle: "/tmp/bundle" })).rejects.toThrow(
      /shippable/,
    );
  });

  it("logs pass/fail counts in the summary line", async () => {
    readFileMock.mockResolvedValue(
      JSON.stringify([
        { id: "c1", query: "q1", cutoffEventId: "e1" },
        { id: "c2", query: "q2", cutoffEventId: "e1" },
        { id: "c3", query: "q3", cutoffEventId: "e1" },
      ]),
    );
    verifyBundleMock.mockResolvedValue({
      integrity: passingIntegrity,
      cases: [
        { id: "c1", layer: "alias", passed: true, allowedFailure: false, chunks: [], failures: [] },
        { id: "c2", layer: "alias", passed: true, allowedFailure: false, chunks: [], failures: [] },
        { id: "c3", layer: "alias", passed: true, allowedFailure: false, chunks: [], failures: [] },
      ],
      blocked: false,
    });

    await run({ cases: "/tmp/cases.json", bundle: "/tmp/bundle" });

    const allLogs = logSpy.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
    expect(allLogs).toContain("--- Verify Summary ---");
    expect(allLogs).toContain("3/3 passed");
    expect(allLogs).toContain("0 failed");
  });

  it("exercises the progress callback from verifyBundle", async () => {
    readFileMock.mockResolvedValue(JSON.stringify([]));
    verifyBundleMock.mockImplementation(async (_bundle, _cases, onProgress) => {
      onProgress?.(1, 2);
      onProgress?.(2, 2);
      return { integrity: passingIntegrity, cases: [], blocked: false };
    });

    await run({ cases: "/tmp/cases.json", bundle: "/tmp/bundle" });
    expect(stdoutSpy).toHaveBeenCalled();
  });

  it("logs chunk info and failure messages for failed cases", async () => {
    readFileMock.mockResolvedValue(
      JSON.stringify([{ id: "c1", query: "q1", cutoffEventId: "e1" }]),
    );
    verifyBundleMock.mockResolvedValue({
      integrity: passingIntegrity,
      cases: [
        {
          id: "c1",
          layer: "alias",
          passed: false,
          allowedFailure: false,
          chunks: [{ id: "chunk-x", articleId: "chunk-x", header: "Header X", hops: 2 }],
          failures: ["assertion failed"],
        },
      ],
      blocked: true,
    });

    await expect(run({ cases: "/tmp/cases.json", bundle: "/tmp/bundle" })).rejects.toThrow(
      CliError,
    );
    const allLogs = logSpy.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
    expect(allLogs).toContain("FAIL");
    expect(allLogs).toContain("chunk-x");
    expect(allLogs).toContain("assertion failed");
  });
});
