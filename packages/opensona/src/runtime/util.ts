// packages/opensona/src/runtime/util.ts
// Browser-compatible gzip decompression via DecompressionStream

export const gunzip = async (data: ArrayBuffer): Promise<ArrayBuffer> => {
  // If the browser (or server) already decompressed the response via
  // Content-Encoding negotiation, the payload won't have a gzip header.
  // Detect this by checking the gzip magic bytes (1f 8b) and skip
  // decompression to avoid the "incorrect header check" error.
  const header = new Uint8Array(data, 0, 2);
  if (header[0] !== 0x1f || header[1] !== 0x8b) {
    return data;
  }

  const ds = new DecompressionStream("gzip");
  const writer = ds.writable.getWriter();
  writer.write(new Uint8Array(data));
  writer.close();

  const reader = ds.readable.getReader();
  const parts: Uint8Array[] = [];
  let totalLength = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    totalLength += value.byteLength;
  }

  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }

  return result.buffer;
};
