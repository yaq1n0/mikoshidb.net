# opensona

A modular RAG (Retrieval-Augmented Generation) toolkit that grounds LLM personas in Fandom wiki content.

Built as a pnpm workspace package with two export paths: a **CLI** for building RAG bundles (Node-only) and a **runtime** for querying them (browser + Node).

Currently validated against the [Cyberpunk 2077 Fandom wiki](https://cyberpunk.fandom.com) for [MikoshiDB.net](https://mikoshidb.net), but designed to work with any Fandom wiki with changes to the open source source code.

## Installation

```bash
npm install opensona
```

Requires Node 22+. The `opensona` CLI is available via `npx opensona` after install.

## Building (CLI)

Transform a Fandom wiki XML dump into a query-ready RAG bundle:

```bash
npx opensona download --wiki cyberpunk
npx opensona prebuild --config <path> --output <dir>
npx opensona build --config <path> --output <dir>
npx opensona verify --cases <path> --bundle <dir>
```

## Querying (runtime)

opensona runs a graph traversal; the caller owns the LLM round-trip that turns a user query into a `TraversalDirective`.

```typescript
import {
  createRuntime,
  assembleLorePreamble,
  buildResolverMessages,
  parseTraversalDirective,
} from "opensona/runtime";

const rt = createRuntime();
await rt.load("/rag/");

const characterContext = {
  id: "v",
  bio: "Mercenary out of Night City.",
  cutoffEventId: "arasaka-tower-raid",
};

const chunks = await rt.query("who is Adam Smasher", {
  characterContext,
  getTraversalPath: async (input) => {
    const messages = buildResolverMessages(input);
    const raw = await yourLLM(messages); // any chat completion that returns JSON
    return parseTraversalDirective(raw);
  },
});

const { source, license } = rt.manifest()!;
const preamble = assembleLorePreamble(chunks, { source, license });
```

## Configuration

opensona ships generic defaults in [config.default.json](config.default.json). Consumers provide a JSON file via `--config` to override any field.

All wiki-specific data (source attribution, edition-era prefixes, category skip rules) lives in consumer config.

## Example configuration

You can find opensona configuration for mikoshidb.net (cyberpunk.fandom.com) on [GitHub](https://github.com/yaq1n0/mikoshidb.net/blob/main/.opensona/opensona.config.json)
