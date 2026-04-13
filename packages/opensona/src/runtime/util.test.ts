import { describe, it, expect } from "vitest";
import { gzipSync } from "node:zlib";
import { gunzip } from "./util.ts";

describe("gunzip()", () => {
  it("decompresses gzip-framed data", async () => {
    const text = "hello world".repeat(50);
    const compressed = gzipSync(Buffer.from(text, "utf-8"));
    const decompressed = await gunzip(
      compressed.buffer.slice(compressed.byteOffset, compressed.byteOffset + compressed.byteLength),
    );
    expect(new TextDecoder().decode(decompressed)).toBe(text);
  });

  it("passes through data that is missing the gzip magic header", async () => {
    const raw = new TextEncoder().encode("not gzip");
    const result = await gunzip(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
    expect(new TextDecoder().decode(result)).toBe("not gzip");
  });

  it("decompresses a large payload that streams as multiple chunks", async () => {
    // ~4MB of JSON-like text forces the DecompressionStream reader to deliver
    // several chunks, exercising the accumulation loop in gunzip().
    const text = "x".repeat(4 * 1024 * 1024);
    const compressed = gzipSync(Buffer.from(text, "utf-8"));
    const decompressed = await gunzip(
      compressed.buffer.slice(compressed.byteOffset, compressed.byteOffset + compressed.byteLength),
    );
    expect(decompressed.byteLength).toBe(text.length);
    // Spot-check the first and last bytes so we don't allocate a second huge string.
    const view = new Uint8Array(decompressed);
    expect(view[0]).toBe("x".charCodeAt(0));
    expect(view[view.length - 1]).toBe("x".charCodeAt(0));
  });

});
