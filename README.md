# mikoshidb.net

A Cyberpunk Mikoshi themed terminal where users load **engrams** (AI character personas, encodes into system prompts in `/src/engrams`) onto **biochip firmwares** (quantised LLMs running entirely in-browser via WebLLM/WebGPU, available models set via `src/firmware`) and chat in-character.

Responses are grounded in Fandom wiki lore through [opensona](packages/opensona/README.md), a RAG toolkit that ships as part of this monorepo that builds the RAG bundle and provides the runtime API.

Character engrams have a temporal cut-off that's lore accurate to when their engram would be created.

Within the mikoshidb.net monorepo, opensona is consumed as a workspace package (`"opensona": "workspace:*"`).

## Dev Prerequisites

- **Node.js** >= 22
- **pnpm** >= 10
- A **WebGPU-capable browser** (Chrome 113+, Edge 113+, or Firefox Nightly)
- A **beefy enough computer** to build the graph RAG artifacts and run the WebLLM models.

## Quick start

```bash
pnpm install
pnpm dev
```

Open the URL shown by Vite. The app will:

1. Run a boot sequence and detect WebGPU support
2. Prompt you to load a firmware (LLM) and jack into an engram (character)
3. Stream in-character chat responses grounded in Cyberpunk wiki lore

## RAG - Build

`.opensona` folder contains

- Configuration: `opensona.config.json`, `opensona.prebuild.json`
- Download Output (pnpm rag:download -> /downloads) Output (/downloads): `dump.xml`
- Prebuild Output (pnpm rag:prebuild -> /generated): `timeline.json`
- Build Output (pnpm rag:build -> /output -> pnpm rag:publish -> copies to public/rag): `aliases.json.gz`, `graph-edges.json.gz`, `graph-nodes.json.gz`

## RAG - Retrieval

User Message -> Rag Retrieval (best effort) -> Append to lore preamble before system prompt

This obeys the character perspective and their temporal cut-off.

### Debug mode

Append `?debug=true` to enable debug side bar.

## Tech stack

- **Vue 3** + **TypeScript** + **Vite**
- **Tailwind CSS v4** for styling
- **WebLLM** (`@mlc-ai/web-llm`) for in-browser LLM inference via WebGPU
- **opensona** for RAG (hybrid BM25 + dense vector retrieval)
- **pnpm workspaces** for monorepo management
