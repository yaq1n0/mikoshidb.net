# Querying RAG Artifacts

How mikoshidb.net uses [opensona](packages/opensona/) at runtime to ground chat responses in Cyberpunk 2077 wiki lore.

## Overview

When a user sends a message, the app retrieves relevant lore chunks from the pre-built RAG bundle before passing the message to the LLM. The retrieved context is injected into the system prompt so the model can answer in-character with accurate lore.

For full details on how retrieval works internally, see the [opensona QUERY docs](packages/opensona/docs/QUERY.md).

## Query flow

1. **User sends a message** in the terminal UI
2. **Embed the query** using the same model used at build time (`bge-small-en-v1.5`, cached in IndexedDB)
3. **Hybrid retrieval** -- dense vector similarity + BM25 sparse matching, fused via Reciprocal Rank Fusion
4. **Temporal filtering** -- chunks referencing events after the engram's cutoff are excluded from results
5. **Assemble lore preamble** -- top-k chunks formatted as a `<lore>` block prepended to the system message
6. **Stream LLM response** -- the model generates an in-character reply grounded in the retrieved lore

## Per-engram cutoffs

Each engram defines a `cutoffEventId` that controls what lore the character has access to:

| Engram            | Cutoff                           | Effect                                              |
| ----------------- | -------------------------------- | --------------------------------------------------- |
| Johnny Silverhand | Pre-Arasaka Tower raid (2023)    | No knowledge of post-raid events or 2077 Night City |
| Alt Cunningham    | Post-Soulkiller, construct state | Knows digital realm events, limited physical world  |
| Saburo Arasaka    | Final engram capture (2076)      | No knowledge of 2077 events or V's story            |
| V                 | Post-Konpeki Plaza (2077)        | Knows early 2077 events, discovering the Relic      |

## Debug mode

Append `?debug=true` to the URL to show a collapsible sidebar with per-turn RAG diagnostics:

- Retrieved chunks with scores and sources (dense/bm25/both)
- Cutoff event applied
- Timing breakdown
- Filtered-out chunk count
