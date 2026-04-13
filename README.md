# mikoshidb.net

A Cyberpunk 2077-themed terminal where users load **engrams** (AI character personas) onto **biochip firmwares** (quantised LLMs running entirely in-browser via WebGPU) and chat in-character. Responses are grounded in Fandom wiki lore through [opensona](packages/opensona/), a modular RAG package that ships as part of this monorepo.

## Prerequisites

- **Node.js** >= 22
- **pnpm** >= 10
- A **WebGPU-capable browser** (Chrome 113+, Edge 113+, or Firefox Nightly)

## Quick start

```bash
pnpm install
pnpm dev
```

Open the URL shown by Vite. The app will:

1. Run a boot sequence and detect WebGPU support
2. Prompt you to load a firmware (LLM) and jack into an engram (character)
3. Stream in-character chat responses grounded in Cyberpunk wiki lore

> **Note:** Chat requires a pre-built RAG bundle. See [RAG_BUILD.md](docs/RAG_BUILD.md) for build instructions.

### Available firmwares

| Codename                     | Model                 | Size    |
| ---------------------------- | --------------------- | ------- |
| Kiroshi MK.IV "Streetdoc"    | Hermes-3-Llama-3.2-3B | ~2.2 GB |
| Militech "Sentinel-8"        | Llama-3.1-8B-Instruct | ~5.1 GB |
| Raven Microcyb "Deepthink-8" | Hermes-3-Llama-3.1-8B | ~5.1 GB |

### Available engrams

| Character         | Era                              | Description                                           |
| ----------------- | -------------------------------- | ----------------------------------------------------- |
| Johnny Silverhand | 2023, pre-Arasaka Tower raid     | Rockerboy, SAMURAI frontman, terrorist                |
| Alt Cunningham    | Post-Soulkiller, construct state | Cryptographer, digital construct beyond the Blackwall |
| Saburo Arasaka    | 2076, final engram capture       | Founder and Chairman of Arasaka Corporation           |
| V                 | 2077, post-Konpeki               | Night City merc, Relic positive                       |

Each engram has a **temporal cutoff** -- RAG retrieval automatically excludes lore events that the character wouldn't know about, preventing anachronistic responses.

## Documentation

- [UI.md](docs/UI.md) -- UI architecture: state, theming, terminal, chat streaming, debug mode
- [RAG_BUILD.md](docs/RAG_BUILD.md) -- how to build the RAG artifacts from wiki data
- [RAG_QUERY.md](docs/RAG_QUERY.md) -- how the app queries and uses RAG at runtime
- [opensona](packages/opensona/) -- the RAG package (generic, wiki-agnostic) shipped from this monorepo

## Development

```bash
pnpm dev              # Vite dev server with WebGPU headers
pnpm build            # Type-check + production build
pnpm typecheck        # Type-check only
pnpm lint             # ESLint
pnpm fmt              # Prettier check
```

### Debug mode

Append `?debug=true` to the URL to show a collapsible sidebar with per-turn RAG diagnostics: retrieved chunks, scores, sources, cutoff event, timing, and filtered-out count.

## Tech stack

- **Vue 3** + **TypeScript** + **Vite**
- **Tailwind CSS v4** for styling
- **WebLLM** (`@mlc-ai/web-llm`) for in-browser LLM inference via WebGPU
- **opensona** for RAG (hybrid BM25 + dense vector retrieval)
- **pnpm workspaces** for monorepo management

## License

Wiki-sourced lore content is licensed under [CC-BY-SA](https://creativecommons.org/licenses/by-sa/3.0/).
