# opensona -- Query Runtime

How opensona retrieves and ranks RAG chunks at query time. The runtime works in both browser and Node environments.

## How retrieval works

The runtime performs **hybrid retrieval**:

1. **Dense scoring** -- brute-force dot product over int8-quantised vectors (~5-15ms for 30k chunks). Timeline filter applied inside the scoring loop.
2. **Sparse scoring** -- BM25 via MiniSearch with fuzzy matching.
3. **RRF fusion** -- Reciprocal Rank Fusion (k=60) merges both result sets.
4. **Prompt assembly** -- top-k chunks formatted as a `<lore>` preamble for the system message.

The embedding model (`Xenova/bge-small-en-v1.5`, 384-dim, ~33MB q8) is loaded via `@huggingface/transformers` and cached in IndexedDB, keyed by the SHA-256 hash of the RAG bundle weights.

## Runtime API

```typescript
import { createRuntime, assembleLorePreamble } from "opensona/runtime";
```

### `createRuntime()`

Returns an `OpersonaRuntime` instance with the following methods:

#### `runtime.load(bundlePath, onProgress?)`

Loads and decompresses the RAG bundle. Idempotent -- concurrent calls are deduped.

```typescript
const rt = createRuntime();
await rt.load("/rag/", (p) => {
  console.log(`${p.phase}: ${(p.ratio * 100).toFixed(0)}%`);
});
```

#### `runtime.query(text, options?)`

Returns the top-k most relevant chunks for a query string.

```typescript
const results = await rt.query("who is Adam Smasher", {
  topK: 3,
  cutoffEventId: "august-19-first-half-of-cp-2077-year-one-events",
});

for (const r of results) {
  console.log(`[${r.source}] ${r.chunk.header} (score: ${r.score.toFixed(3)})`);
  console.log(r.chunk.text);
}
```

#### `runtime.inspect(text, options?)`

Like `query`, but returns all three result sets for debugging:

```typescript
const { dense, bm25, fused } = await rt.inspect("soulkiller");
```

#### `runtime.manifest()`

Returns the loaded `Manifest` object (includes timeline, build metadata, file checksums), or `null` if not yet loaded.

### `assembleLorePreamble(chunks)`

Formats retrieved chunks into a `<lore>` block for use as an LLM system message preamble.

### `QueryOptions`

| Option          | Type                 | Default | Description                                  |
| --------------- | -------------------- | ------- | -------------------------------------------- |
| `topK`          | `number`             | `3`     | Number of chunks to return                   |
| `cutoffEventId` | `string`             | --      | Exclude chunks with events after this cutoff |
| `excludeTags`   | `string[]`           | --      | Exclude chunks with any of these tags        |
| `filter`        | `(chunk) => boolean` | --      | Custom post-filter                           |

## Core types

```typescript
interface TimelineEvent {
  id: string; // slugified, e.g. "night-city-holocaust-nuclear-device-detonated"
  name: string; // human-readable, ~80 chars
  year: number; // in-universe year
  order: number; // global total ordering
  keywords?: string[]; // wiki-linked entity names for auto-tagging
}

interface Chunk {
  id: string; // articleSlug#chunkIndex
  articleId: string;
  title: string;
  header: string; // "[Article > Section]"
  text: string;
  eventIds: string[];
  latestEventOrder: number; // max order among matched events; -1 = timeless
  tags: string[];
  categories: string[];
}

interface RetrievedChunk {
  chunk: Chunk;
  score: number;
  source: "dense" | "bm25" | "both";
}
```
