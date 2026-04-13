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
        { name: "c1", query: "q1", cutoffEventId: "e1" },
        { name: "c2", query: "q2", cutoffEventId: "e1" },
      ]),
    );
    verifyBundleMock.mockResolvedValue([
      {
        name: "c1",
        passed: true,
        query: "q1",
        chunks: [],
        failures: [],
      },
      {
        name: "c2",
        passed: false,
        query: "q2",
        chunks: [{ id: "x", header: "h", hops: 1, textSnippet: "snip" }],
        failures: ["missing thing"],
      },
    ]);

    await expect(run({ cases: "/tmp/cases.json", bundle: "/tmp/bundle" })).rejects.toThrow(
      CliError,
    );
    await expect(run({ cases: "/tmp/cases.json", bundle: "/tmp/bundle" })).rejects.toThrow(
      /1 verify case/,
    );
  });

  it("logs pass/fail counts in the summary line", async () => {
    readFileMock.mockResolvedValue(
      JSON.stringify([
        { name: "c1", query: "q1", cutoffEventId: "e1" },
        { name: "c2", query: "q2", cutoffEventId: "e1" },
        { name: "c3", query: "q3", cutoffEventId: "e1" },
      ]),
    );
    verifyBundleMock.mockResolvedValue([
      { name: "c1", passed: true, query: "q1", chunks: [], failures: [] },
      { name: "c2", passed: true, query: "q2", chunks: [], failures: [] },
      { name: "c3", passed: true, query: "q3", chunks: [], failures: [] },
    ]);

    await run({ cases: "/tmp/cases.json", bundle: "/tmp/bundle" });

    const allLogs = logSpy.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
    expect(allLogs).toContain("--- Verify Summary ---");
    expect(allLogs).toContain("Passed: 3/3");
    expect(allLogs).toContain("Failed: 0/3");
  });

  it("exercises the progress callback from verifyBundle", async () => {
    readFileMock.mockResolvedValue(JSON.stringify([]));
    verifyBundleMock.mockImplementation(async (_bundle, _cases, onProgress) => {
      onProgress?.(1, 2);
      onProgress?.(2, 2);
      return [];
    });

    await run({ cases: "/tmp/cases.json", bundle: "/tmp/bundle" });
    expect(stdoutSpy).toHaveBeenCalled();
  });

  it("logs chunk info and failure messages for failed cases", async () => {
    readFileMock.mockResolvedValue(
      JSON.stringify([{ name: "c1", query: "q1", cutoffEventId: "e1" }]),
    );
    verifyBundleMock.mockResolvedValue([
      {
        name: "c1",
        passed: false,
        query: "q1",
        chunks: [{ id: "chunk-x", header: "Header X", hops: 2, textSnippet: "snip" }],
        failures: ["assertion failed"],
      },
    ]);

    await expect(run({ cases: "/tmp/cases.json", bundle: "/tmp/bundle" })).rejects.toThrow(
      CliError,
    );
    const allLogs = logSpy.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
    expect(allLogs).toContain("FAIL");
    expect(allLogs).toContain("chunk-x");
    expect(allLogs).toContain("assertion failed");
  });
});
