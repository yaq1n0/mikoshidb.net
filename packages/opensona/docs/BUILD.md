# opensona -- Build Pipeline

How opensona transforms a raw Fandom wiki XML dump into a compact, query-ready RAG bundle.

## Pipeline overview

```
XML dump
  -> parse (wtf_wikipedia, SAX streaming)
  -> chunk (~350 tok paragraphs with [Article > Section] headers)
  -> embed (bge-small-en-v1.5 via @huggingface/transformers)
  -> pack (int8 quantise + BM25 index + gzip)
  -> bundle (manifest.json + chunks.json.gz + embeddings.i8.bin + bm25.json.gz)
```

## Temporal filtering

Opensona auto-generates a timeline of ~200 in-universe events from the wiki's own "Timeline" article. Each chunk is tagged with the events it references (via category mapping + keyword matching). At query time, a `cutoffEventId` excludes chunks about events the persona shouldn't know about.

This enables characters like Johnny Silverhand to answer questions about Adam Smasher (pre-raid) but refuse to discuss what happened after his death -- without any manual curation.

## CLI commands

The CLI is built with Commander. All examples below use `tsx` to run the entry point directly:

```bash
tsx packages/opensona/src/cli/index.ts <command> [options]
```

### `download` -- fetch wiki dump

```bash
opensona download --wiki <subdomain> [--output <path>] [--force]
```

| Flag                 | Required | Default                     | Description                              |
| -------------------- | -------- | --------------------------- | ---------------------------------------- |
| `--wiki <subdomain>` | yes      | --                          | Fandom wiki subdomain (e.g. `cyberpunk`) |
| `--output <path>`    | no       | `.opensona/.cache/dump.xml` | Output path for the XML dump             |
| `--force`            | no       | `false`                     | Re-download even if dump already exists  |

### `prebuild` -- generate timeline and category map

```bash
opensona prebuild --config <path> --output <dir>
```

| Flag              | Required | Description                                                  |
| ----------------- | -------- | ------------------------------------------------------------ |
| `--config <path>` | yes      | Config JSON path (merged over defaults)                      |
| `--output <dir>`  | yes      | Output directory for `timeline.json` and `category-map.json` |

### `build` -- full pipeline

```bash
opensona build --config <path> --output <dir>
```

| Flag              | Required | Description                             |
| ----------------- | -------- | --------------------------------------- |
| `--config <path>` | yes      | Config JSON path (merged over defaults) |
| `--output <dir>`  | yes      | Output directory for the bundle         |

Requires prebuild output (timeline + category map) in the `generatedDir` specified by config.

### `verify` -- smoke-test retrieval

```bash
opensona verify --cases <path> --bundle <dir>
```

| Flag             | Required | Description               |
| ---------------- | -------- | ------------------------- |
| `--cases <path>` | yes      | JSON file with test cases |
| `--bundle <dir>` | yes      | Path to built bundle      |

Each test case has this shape:

```json
{
  "name": "Johnny knows Adam Smasher",
  "query": "who is Adam Smasher",
  "cutoffEventId": "arasaka-tower-raid",
  "mustContain": ["Adam Smasher"],
  "mustNotContain": ["V", "relic"]
}
```

## Configuration

The CLI ships a default config (`config.default.json` inside the package). Your project config is deep-merged over these defaults, so you only need to specify overrides.

```jsonc
{
  // Path to the MediaWiki XML dump
  "dumpPath": ".opensona/.cache/dump.xml",

  // Directory for prebuild output (timeline.json, category-map.json)
  "generatedDir": ".opensona/generated",

  // Attribution metadata (written into manifest.json)
  "source": "https://cyberpunk.fandom.com",
  "license": "CC-BY-SA",

  // Embedding model
  "embedder": {
    "model": "Xenova/bge-small-en-v1.5", // HuggingFace model ID
    "dim": 384, // vector dimensionality
    "batchSize": 128, // chunks per embedding batch
  },

  // Chunking parameters
  "chunking": {
    "targetTokens": 350, // aim for this many tokens per chunk
    "maxTokens": 512, // hard ceiling
    "overlapTokens": 50, // overlap between consecutive chunks
  },

  // Hard limit on total bundle size (bytes)
  "maxBundleBytes": 157286400,

  // BM25 index configuration
  "bm25": {
    "fields": ["title", "header", "text"],
    "boosts": { "title": 3, "header": 2, "text": 1 },
  },
}
```

### Using with a different wiki

1. Download your wiki's dump: `opensona download --wiki <your-subdomain>`
2. Create a config JSON that overrides `source` and `license` (and any chunking/embedding tweaks)
3. Run `prebuild` then `build` with your config
4. Point the runtime at your output directory

The only wiki-specific requirement is a "Timeline" article in the dump for temporal filtering. If your wiki doesn't have one, prebuild will produce an empty timeline and all chunks will be treated as timeless.
