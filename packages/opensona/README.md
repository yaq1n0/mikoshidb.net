# opensona

A modular RAG (Retrieval-Augmented Generation) toolkit that grounds LLM personas in Fandom wiki content. Built as a pnpm workspace package with two export paths: a **CLI** for building RAG bundles (Node-only) and a **runtime** for querying them (browser + Node).

Currently validated against the [Cyberpunk 2077 Fandom wiki](https://cyberpunk.fandom.com) for [MikoshiDB.net](https://mikoshidb.net), but designed to work with any Fandom wiki with changes to the open source source code.

## Documentation

- [BUILD.md](docs/BUILD.md) -- CLI and config for download -> prebuild -> build -> verify
- [QUERY.md](docs/QUERY.md) -- runtime API, retrieval algorithm, and core types

## Installation

```bash
npm install opensona
# or
pnpm add opensona
```

Requires Node 22+. The `opensona` CLI is available via `npx opensona` after install.

Within the mikoshidb.net monorepo, opensona is consumed as a workspace package (`"opensona": "workspace:*"`).

## Quick overview

### Building (CLI)

Transform a Fandom wiki XML dump into a query-ready RAG bundle:

```bash
npx opensona download --wiki cyberpunk
npx opensona prebuild --config <path> --output <dir>
npx opensona build --config <path> --output <dir>
npx opensona verify --cases <path> --bundle <dir>
```

See [BUILD.md](docs/BUILD.md) for the full pipeline, all CLI flags, and configuration schema.

### Querying (runtime)

```typescript
import { createRuntime, assembleLorePreamble } from "opensona/runtime";

const rt = createRuntime();
await rt.load("/rag/");

const results = await rt.query("who is Adam Smasher", {
  topK: 3,
  cutoffEventId: "arasaka-tower-raid",
});

const { source, license } = rt.manifest()!;
const preamble = assembleLorePreamble(results, { source, license });
```

See [QUERY.md](docs/QUERY.md) for the full API reference, retrieval algorithm, and type definitions.

## Configuration

opensona ships generic defaults in [config.default.json](config.default.json). Consumers provide a JSON file via `--config` to override any field. All wiki-specific data (source attribution, edition-era prefixes, category skip rules) lives in consumer config — not in the package.

### Schema

```ts
interface OpensonaConfig {
  dumpPath: string; // e.g. ".opensona/.cache/dump.xml"
  generatedDir: string; // where prebuild writes timeline.json / category-map.json
  source: string; // attribution URL, stamped into the bundle manifest
  license: string; // e.g. "CC-BY-SA", stamped into the bundle manifest
  embedder: { model: string; dim: number; batchSize: number };
  chunking: { targetTokens: number; maxTokens: number; overlapTokens: number };
  maxBundleBytes: number;
  bm25: { fields: string[]; boosts: Record<string, number> };

  // The wiki article whose bullets seed the timeline.
  timelineArticleTitle: string; // default "Timeline"
  timelineValidation: { minYearHeadings: number; minEvents: number };

  // Category prefix -> era/year range. Categories starting with `prefix`
  // anchor to the first timeline event within [startYear, endYear].
  // List longer prefixes first — matching is first-win.
  editionEras: Array<{ prefix: string; label: string; startYear: number; endYear: number }>;

  // Filters applied to wiki categories before mapping to events.
  categorySkip: { prefixes: string[]; suffixes: string[]; exact: string[] };
}
```

### Example: a generic fantasy wiki

```json
{
  "source": "https://example-fantasy.fandom.com",
  "license": "CC-BY-SA",
  "timelineArticleTitle": "Timeline of Events",
  "editionEras": [
    { "prefix": "Third Age", "label": "Third Age", "startYear": 3000, "endYear": 3021 },
    { "prefix": "Second Age", "label": "Second Age", "startYear": 1, "endYear": 3441 },
    { "prefix": "First Age", "label": "First Age", "startYear": -500, "endYear": 0 }
  ],
  "categorySkip": {
    "prefixes": ["Behind the Scenes", "Real world"],
    "suffixes": ["images", "templates"],
    "exact": ["Disambiguations", "Article stubs"]
  }
}
```

For a real-world example consumer, see [.opensona/opensona.config.json](../../.opensona/opensona.config.json) (the Cyberpunk Fandom wiki configuration used by MikoshiDB.net).
