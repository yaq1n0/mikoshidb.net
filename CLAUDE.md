# CLAUDE.md

## Layout

pnpm workspace.

- `/` — `mikoshidb.net` Vue 3 + Vite web app. Source: `src/`. Depends on `opensona` (workspace) via `opensona/runtime` for in-browser RAG.
- `packages/opensona/` — published package. CLI (`download`, `prebuild`, `build`, `verify`) in `packages/opensona/src/cli/` builds a RAG bundle from Fandom dumps. Runtime in `packages/opensona/src/runtime/` loads it (browser + Node). Root `rag:*` scripts drive the CLI; `scripts/publish-rag.sh` copies the bundle into the web app.

## Commands

Run in the workspace you touched. If both, run both.

- Root: `pnpm typecheck`, `pnpm lint:fix`, `pnpm fmt:fix`, `pnpm test`.
- `packages/opensona`: `pnpm typecheck`, `pnpm test`.

After edits: typecheck + lint + test for touched workspace(s).

## TS rules

- `type` over `interface`. Exception: use `interface` when `extends` is needed.
- `const x = () => {}` over `function x() {}`. Exception: Vue composables (`function useX()`), and cases needing hoisting or `this`.
- JSDoc on every function. One line.
- Comments explain why, not what. Delete comments that restate the code.

## Framework

Vue 3 Composition API + `<script setup lang="ts">`. Pinia for state (typed). Prefer `ref`/`computed` over options API.
