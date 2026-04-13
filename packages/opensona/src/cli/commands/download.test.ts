import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { CliError } from "../errors.ts";

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  stat: vi.fn(),
  rename: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined),
  mkdtemp: vi.fn().mockResolvedValue("/tmp/opensona-dump-XXXX"),
  copyFile: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("node:fs", () => ({
  createWriteStream: vi.fn(),
}));

vi.mock("node:stream/promises", () => ({
  pipeline: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("7zip-min", () => ({
  default: { unpack: vi.fn().mockResolvedValue("") },
}));

import { mkdir, stat, rename, rm } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import _7z from "7zip-min";
import { dumpUrl, run } from "./download.ts";

const statMock = stat as unknown as ReturnType<typeof vi.fn>;
const mkdirMock = mkdir as unknown as ReturnType<typeof vi.fn>;
const renameMock = rename as unknown as ReturnType<typeof vi.fn>;
const rmMock = rm as unknown as ReturnType<typeof vi.fn>;
const createWriteStreamMock = createWriteStream as unknown as ReturnType<typeof vi.fn>;
const pipelineMock = pipeline as unknown as ReturnType<typeof vi.fn>;
const unpackMock = _7z.unpack as unknown as ReturnType<typeof vi.fn>;

const okResponse = (body = "") => {
  // A minimal ReadableStream-like body that pipeline is mocked anyway
  return {
    ok: true,
    status: 200,
    body: new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode(body));
        c.close();
      },
    }),
    headers: new Headers({
      "last-modified": "Wed, 11 Mar 2026 15:44:40 GMT",
      "content-length": "1",
    }),
  } as unknown as Response;
};

const errResponse = (status: number) => {
  return { ok: false, status, body: null, headers: new Headers() } as unknown as Response;
};

describe("dumpUrl()", () => {
  it("builds S3 URL from subdomain", () => {
    expect(dumpUrl("cyberpunk")).toBe(
      "https://s3.amazonaws.com/wikia_xml_dumps/c/cy/cyberpunk_pages_current.xml.7z",
    );
  });

  it("lowercases the subdomain", () => {
    expect(dumpUrl("Cyberpunk")).toBe(
      "https://s3.amazonaws.com/wikia_xml_dumps/c/cy/cyberpunk_pages_current.xml.7z",
    );
  });

  it("handles single-character subdomain", () => {
    expect(dumpUrl("a")).toBe(
      "https://s3.amazonaws.com/wikia_xml_dumps/a/a/a_pages_current.xml.7z",
    );
  });

  it("allows hyphens and digits", () => {
    expect(dumpUrl("star-wars-99")).toContain("/s/st/star-wars-99_pages_current.xml.7z");
  });

  it("rejects empty / invalid subdomains", () => {
    expect(() => dumpUrl("")).toThrow(CliError);
    expect(() => dumpUrl("bad name")).toThrow(CliError);
    expect(() => dumpUrl("bad/slash")).toThrow(CliError);
  });
});

describe("download run()", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    statMock.mockReset();
    mkdirMock.mockReset().mockResolvedValue(undefined);
    renameMock.mockReset().mockResolvedValue(undefined);
    rmMock.mockReset().mockResolvedValue(undefined);
    createWriteStreamMock.mockReset().mockReturnValue(new EventEmitter());
    pipelineMock.mockReset().mockResolvedValue(undefined);
    unpackMock.mockReset().mockResolvedValue("");
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    logSpy.mockRestore();
  });

  it("existing non-empty file without --force short-circuits (no fetch)", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    statMock.mockResolvedValueOnce({ size: 5 * 1024 * 1024 } as never);

    await run({ wiki: "cyberpunk", output: "/tmp/existing.xml" });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("--force bypasses existing-file check", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(okResponse());
    // stat calls during run: one to verify extracted file, one for final size
    statMock.mockResolvedValue({ size: 51_000_000 } as never);

    await run({ wiki: "cyberpunk", output: "/tmp/out.xml", force: true });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(unpackMock).toHaveBeenCalledTimes(1);
    expect(renameMock).toHaveBeenCalledTimes(1);
  });

  it("proceeds to download when stat() throws ENOENT", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    // First stat (existence check) throws, subsequent stats succeed
    statMock.mockRejectedValueOnce(new Error("ENOENT"));
    statMock.mockResolvedValue({ size: 51_000_000 } as never);
    fetchMock.mockResolvedValueOnce(okResponse());

    await run({ wiki: "cyberpunk", output: "/tmp/new.xml" });

    expect(fetchMock).toHaveBeenCalled();
    expect(unpackMock).toHaveBeenCalled();
  });

  it("throws CliError with HTTP status when download returns 404", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    statMock.mockRejectedValueOnce(new Error("ENOENT"));
    fetchMock.mockResolvedValueOnce(errResponse(404));

    const err = await run({ wiki: "nope", output: "/tmp/out.xml" }).catch((e) => e);
    expect(err).toBeInstanceOf(CliError);
    expect(err.message).toMatch(/HTTP 404/);
  });

  it("throws CliError when response body is missing", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    statMock.mockRejectedValueOnce(new Error("ENOENT"));
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: null,
      headers: new Headers(),
    } as unknown as Response);

    await expect(run({ wiki: "cyberpunk", output: "/tmp/o.xml" })).rejects.toThrow(
      /Empty response/,
    );
  });

  it("throws CliError when extracted XML is missing from archive", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(okResponse());
    statMock.mockRejectedValueOnce(new Error("ENOENT")); // first: existence check
    statMock.mockRejectedValueOnce(new Error("ENOENT")); // second: extracted file missing

    await expect(run({ wiki: "cyberpunk", output: "/tmp/o.xml", force: true })).rejects.toThrow(
      /not found/,
    );
  });

  it("falls back to copy+unlink when rename hits EXDEV", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(okResponse());
    statMock.mockResolvedValue({ size: 10 } as never);
    const exdev = Object.assign(new Error("EXDEV"), { code: "EXDEV" });
    renameMock.mockRejectedValueOnce(exdev);

    await run({ wiki: "cyberpunk", output: "/tmp/o.xml", force: true });
    // if we got here without throwing, the fallback path ran
    expect(renameMock).toHaveBeenCalled();
  });
});
