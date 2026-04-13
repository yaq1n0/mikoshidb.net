# Building RAG Artifacts

How mikoshidb.net uses [opensona](packages/opensona/) to build the RAG bundle that grounds chat responses in Cyberpunk 2077 wiki lore.

## Overview

The canonical RAG bundle lives at `.opensona/output/` and is committed to git. `public/rag/` is a gitignored publish copy populated via `pnpm rag:publish` ([scripts/publish-rag.sh](../scripts/publish-rag.sh)), which is wired to the `predev` and `prebuild` npm lifecycle hooks — so `pnpm dev` and `pnpm build` always serve a fresh copy of `.opensona/output/` without a manual publish step. The build pipeline downloads a Fandom wiki XML dump, parses it into chunks, embeds them, and packs everything into a compact bundle.

For full details on how the pipeline works internally, see the [opensona BUILD docs](packages/opensona/docs/BUILD.md).

## Build steps

```bash
pnpm rag:download    # fetch Cyberpunk Fandom wiki XML dump
pnpm rag:prebuild    # generate timeline + category map from dump
pnpm rag:build       # parse -> chunk -> embed -> quantise -> pack
pnpm rag:verify      # smoke-test temporal filtering and retrieval
```

These scripts wrap the [opensona CLI](packages/opensona/docs/BUILD.md#cli-commands) with project-specific config from `.opensona/`.

## What gets built

The pipeline produces a bundle in `.opensona/output/` containing:

| File                | Description                               |
| ------------------- | ----------------------------------------- |
| `manifest.json`     | Timeline, build metadata, file checksums  |
| `chunks.json.gz`    | All parsed/tagged text chunks (gzipped)   |
| `embeddings.i8.bin` | Int8-quantised embedding vectors          |
| `bm25.json.gz`      | Pre-built BM25 index for sparse retrieval |

## Temporal filtering

Each engram has a **temporal cutoff** -- the build pipeline tags every chunk with the in-universe events it references. At query time, chunks about events after the character's cutoff are excluded. This prevents anachronistic responses (e.g. Johnny Silverhand won't discuss events after the Arasaka Tower raid).

See the [opensona BUILD docs](packages/opensona/docs/BUILD.md#temporal-filtering) for how tagging works.
