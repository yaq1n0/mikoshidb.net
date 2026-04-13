import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { CliError } from "../errors.ts";

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  stat: vi.fn(),
}));

vi.mock("node:fs", () => ({
  createWriteStream: vi.fn(),
}));

import { mkdir, stat } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { escapeXml, run } from "./download.ts";

const statMock = stat as unknown as ReturnType<typeof vi.fn>;
const mkdirMock = mkdir as unknown as ReturnType<typeof vi.fn>;
const createWriteStreamMock = createWriteStream as unknown as ReturnType<typeof vi.fn>;

function makeFakeStream() {
  const writes: string[] = [];
  const emitter = new EventEmitter() as EventEmitter & {
    write: (s: string) => void;
    end: () => void;
    writes: string[];
  };
  emitter.write = (s: string) => {
    writes.push(s);
  };
  emitter.end = () => {
    // Emit finish on the next tick so the await in run() can resolve
    setImmediate(() => emitter.emit("finish"));
  };
  emitter.writes = writes;
  return emitter;
}

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
  };
}

describe("escapeXml()", () => {
  it("escapes ampersands, lt, and gt", () => {
    expect(escapeXml("a & b < c > d")).toBe("a &amp; b &lt; c &gt; d");
  });

  it("escapes '&' before other chars so we don't double-encode", () => {
    expect(escapeXml("<tag>&amp;</tag>")).toBe("&lt;tag&gt;&amp;amp;&lt;/tag&gt;");
  });

  it("leaves plain strings untouched", () => {
    expect(escapeXml("hello world")).toBe("hello world");
  });
});

describe("download run()", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    statMock.mockReset();
    mkdirMock.mockReset().mockResolvedValue(undefined);
    createWriteStreamMock.mockReset();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    logSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  it("throws CliError with HTTP status when siteinfo returns 404", async () => {
    statMock.mockRejectedValue(new Error("ENOENT"));
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({}, false, 404));

    const err = await run({ wiki: "nope", output: "/tmp/out.xml" }).catch((e) => e);
    expect(err).toBeInstanceOf(CliError);
    expect(err.message).toMatch(/HTTP 404/);
  });

  it("follows two apcontinue tokens then terminates pagination", async () => {
    statMock.mockRejectedValue(new Error("ENOENT"));
    const stream = makeFakeStream();
    createWriteStreamMock.mockReturnValue(stream);

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    // 1) siteinfo
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ query: { general: { sitename: "Test Wiki" } } }),
    );
    // 2) allpages page 1 → returns one title + apcontinue "a"
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        query: { allpages: [{ title: "P1" }] },
        continue: { apcontinue: "a" },
      }),
    );
    // 3) allpages page 2 → one title + apcontinue "b"
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        query: { allpages: [{ title: "P2" }] },
        continue: { apcontinue: "b" },
      }),
    );
    // 4) allpages page 3 → one title, no continue → terminate
    fetchMock.mockResolvedValueOnce(jsonResponse({ query: { allpages: [{ title: "P3" }] } }));
    // 5) One batch fetch for all 3 titles (batchSize=50)
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        query: {
          pages: [
            {
              title: "P1",
              ns: 0,
              revisions: [{ slots: { main: { content: "c1" } } }],
            },
            {
              title: "P2",
              ns: 0,
              revisions: [{ slots: { main: { content: "c2" } } }],
            },
            {
              title: "P3",
              ns: 0,
              revisions: [{ slots: { main: { content: "c3" } } }],
            },
          ],
        },
      }),
    );
    // stat after write completes
    statMock.mockResolvedValueOnce({ size: 1024 * 1024 } as never);

    await run({ wiki: "test", output: "/tmp/out.xml", force: true });

    // siteinfo + 3 allpages + 1 batch = 5 fetches
    expect(fetchMock).toHaveBeenCalledTimes(5);

    // apcontinue tokens appeared in the URL params of calls 3 and 4
    const call3Url = fetchMock.mock.calls[2][0] as string;
    const call4Url = fetchMock.mock.calls[3][0] as string;
    expect(call3Url).toContain("apcontinue=a");
    expect(call4Url).toContain("apcontinue=b");

    // Stream received header + footer
    expect(stream.writes.some((w) => w.includes("<?xml"))).toBe(true);
    expect(stream.writes.some((w) => w.includes("</mediawiki>"))).toBe(true);
  });

  it("--force bypasses existing-file check (no stat short-circuit)", async () => {
    // stat would return a big file, but --force means we shouldn't even call it
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const stream = makeFakeStream();
    createWriteStreamMock.mockReturnValue(stream);

    fetchMock.mockResolvedValueOnce(jsonResponse({ query: { general: { sitename: "W" } } }));
    fetchMock.mockResolvedValueOnce(jsonResponse({ query: { allpages: [] } }));
    statMock.mockResolvedValueOnce({ size: 42 } as never);

    await run({ wiki: "w", output: "/tmp/out.xml", force: true });

    // With --force, stat() should NOT be called for the short-circuit check.
    // It IS called once at the end for the final size report.
    expect(statMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalled();
  });

  it("existing non-empty file without --force short-circuits (no fetch)", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    statMock.mockResolvedValueOnce({ size: 5 * 1024 * 1024 } as never);

    await run({ wiki: "anything", output: "/tmp/existing.xml" });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("proceeds to download when stat() throws ENOENT", async () => {
    statMock.mockRejectedValueOnce(new Error("ENOENT"));
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const stream = makeFakeStream();
    createWriteStreamMock.mockReturnValue(stream);

    fetchMock.mockResolvedValueOnce(jsonResponse({ query: { general: { sitename: "W" } } }));
    fetchMock.mockResolvedValueOnce(jsonResponse({ query: { allpages: [] } }));
    statMock.mockResolvedValueOnce({ size: 100 } as never);

    await run({ wiki: "w", output: "/tmp/new.xml" });

    expect(fetchMock).toHaveBeenCalled();
  });

  it("throws CliError when allpages fetch returns non-OK", async () => {
    statMock.mockRejectedValueOnce(new Error("ENOENT"));
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(jsonResponse({ query: { general: { sitename: "W" } } }));
    fetchMock.mockResolvedValueOnce(jsonResponse({}, false, 503));

    await expect(run({ wiki: "w", output: "/tmp/o.xml" })).rejects.toThrow(/HTTP 503/);
  });

  it("throws CliError when batch fetch returns non-OK", async () => {
    statMock.mockRejectedValueOnce(new Error("ENOENT"));
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const stream = makeFakeStream();
    createWriteStreamMock.mockReturnValue(stream);

    fetchMock.mockResolvedValueOnce(jsonResponse({ query: { general: { sitename: "W" } } }));
    fetchMock.mockResolvedValueOnce(jsonResponse({ query: { allpages: [{ title: "A" }] } }));
    fetchMock.mockResolvedValueOnce(jsonResponse({}, false, 500));

    await expect(run({ wiki: "w", output: "/tmp/o.xml" })).rejects.toThrow(/HTTP 500/);
  });

  it("skips missing / empty-revision pages and writes redirect markers", async () => {
    statMock.mockRejectedValueOnce(new Error("ENOENT"));
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const stream = makeFakeStream();
    createWriteStreamMock.mockReturnValue(stream);

    fetchMock.mockResolvedValueOnce(jsonResponse({ query: { general: { sitename: "W" } } }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ query: { allpages: [{ title: "A" }, { title: "B" }, { title: "C" }] } }),
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        query: {
          pages: [
            { title: "A", ns: 0, missing: true },
            { title: "B", ns: 0, revisions: [{ slots: { main: { content: "" } } }] },
            {
              title: "C",
              ns: 0,
              redirect: true,
              revisions: [{ slots: { main: { content: "redir" } } }],
            },
          ],
        },
      }),
    );
    statMock.mockResolvedValueOnce({ size: 1 } as never);

    await run({ wiki: "w", output: "/tmp/o.xml" });

    const full = stream.writes.join("");
    expect(full).toContain("<title>C</title>");
    expect(full).toContain("<redirect />");
    expect(full).not.toContain("<title>A</title>");
    expect(full).not.toContain("<title>B</title>");
  });
});
