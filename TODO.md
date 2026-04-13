# TODO — graph-rag migration finish line

Scope: everything left before this branch ships as (a) `opensona@0.2.0` on npm
and (b) a green, reviewed `mikoshidb.net` deploy. Ordered roughly by how load-
bearing each item is.

## opensona v0.2.0

### Blockers (tests and build gates)

- [ ] **Fix `packages/opensona/src/cli/commands/verify.test.ts`.** Currently
      fails — test mocks `verifyBundle` to return the pre-migration shape
      (array of case results) but `verify.ts` now expects
      `{ integrity, cases, blocked }`. Rewrite the mocks + assertions against
      the new `VerifyReport`.
- [ ] **Fix `packages/opensona/src/cli/commands/prebuild.test.ts`.** Mocks
      `parseDump` to return `[{title,…}]` but it now returns
      `{ articles, redirects }`. Update the mock return values.
- [ ] **Re-add unit tests** for the restored + new modules — inventory of
      files that had sibling `.test.ts` before the wipe but don't now:
  - `src/build/parse.ts` (regression: redirects retained, links surfaced,
    infobox extraction)
  - `src/build/aliases.ts` (normalize/softNormalize, redirects, infobox
    list splitting, resolveAlias precedence)
  - `src/build/graph.ts` (parseSectionYear, event floor propagation, lead
    truncation at sentence boundary, dead-link accounting)
  - `src/build/pack-graph.ts`
  - `src/build/verify.ts` (integrity dangling buckets, alias case shape,
    `expectEmpty` / `expectAny` / `mustNotArticleIds` / `assertNoPostCutoff`)
  - `src/runtime/graph.ts` (hydrateGraph)
  - `src/runtime/loader.ts` (idempotency, version gate, fetchOverride)
  - `src/runtime/resolve.ts` (buildResolverMessages snapshot,
    parseTraversalDirective tolerances, warmEngram caps)
  - `src/runtime/traverse.ts` (hops ordering, cutoff, excludeTags,
    include_categories seed, section vs lead emit, maxChunks cap)
  - `src/runtime/index.ts` (vocab cache, resolver throw → [], empty
    directive → [], onTrace fires)
  - `src/config.ts` (restore `config.test.ts`)
- [ ] **Reset vitest coverage gate.** `packages/opensona/vitest.config.ts`
      still targets 90/90/85/90. Leave it, but only after tests land.
- [ ] **Regenerate `pnpm-lock.yaml`.** Dependencies were removed from
      `packages/opensona/package.json` but the lockfile is unchanged in the
      working tree. Run `pnpm install` at the root and commit the lock diff.
- [ ] **Bump `packages/opensona/package.json` version → `0.2.0`.** Breaking:
      manifest v1 → v2, retrieval kind `"hybrid"` → `"graph"`, `Runtime.query`
      signature change, `RetrievedChunk.score` → `.hops`, deletion of
      `@huggingface/transformers` and `minisearch` deps.

### Dead code / cleanup

- [ ] **Kill stale `docs/QUERY.md` comments.** File was only partially
      updated (score→hops, source enum). Rewrite the "How retrieval works"
      section and the `QueryOptions` table against the new graph runtime.
- [ ] **Rewrite `packages/opensona/docs/BUILD.md`.** Pipeline diagram still
      says `chunk → embed → pack`. Describe `parse → buildGraph → packGraph`.
      Remove the embedder config schema; document `graph.*` fields.
- [ ] **Update `packages/opensona/README.md`.** Quick-start snippet still
      shows `rt.query("…", { topK, cutoffEventId })`. Replace with the
      `getTraversalPath` + `characterContext` example. Update the
      `OpensonaConfig` schema block (embedder/chunking/bm25 fields gone).
- [ ] **Pick a home for the breaking-change notice.** Either add
      `packages/opensona/CHANGELOG.md` or a `MIGRATION.md` — downstream
      consumers need to know how to swap their `query()` call.
- [ ] **Decide on `config.default.json.maxBundleBytes`.** Still there, still
      defaults to 50 MiB, but graph bundles are ~5–6 MB; either drop the field
      or keep as a loose ceiling and assert it in `packGraph`.

### End-to-end validation

- [ ] Run `pnpm rag:download && pnpm rag:prebuild && pnpm rag:build` from a
      clean `.opensona/output/` and confirm bundle size ~5–6 MB, deadLinkCount
      sane, no integrity failures.
- [ ] Run `pnpm rag:verify` against the committed bundle and the
      `packages/opensona/cases/graph-verify.json` cases until all non-soft
      cases pass.
- [ ] Flesh out the `--with-llm` hook in `verify.ts` (currently stub: it
      rejects `layer !== "alias"`). Either wire it to a caller-provided
      `getTraversalPath` or remove the layer field from the case schema and
      the README pitch.

## mikoshidb.net

### Tests + typechecks

- [ ] Add unit tests for `src/terminal/commands.ts::retrieveLore` — at
      minimum the four resolver outcomes (happy, `parse-error`,
      `empty-directive`, `throw`) and the preamble-budget trim loop.
      Chat/terminal/boot/session already have coverage; RAG retrieval path
      does not.
- [ ] Manually test the four engrams end-to-end in a browser with
      `?debug=true`:
  - Johnny Silverhand: "how did you meet rogue" (two-hop), "who's jaxon
    mckinley" (unresolved → empty), "what happened at konpeki plaza"
    (cutoff should drop chunks).
  - Alt Cunningham: "who is soulkiller" (alias → direct hit).
  - Saburo Arasaka: post-2076 event queries should be cutoff-filtered.
  - V: verify the Phantom Liberty cutoff tag path.
  Confirm Resolver panel (messages, raw, parsed, fallback) and Traversal
  panel (node list with hops / kind / droppedReason) populate.
- [ ] Verify IDB migration: install a previous main-branch build, boot it,
      then check out graph-rag and reload. `DB_SCHEMA_VERSION` bump should
      delete + recreate the `rag-log` store without prompting.
- [ ] `pnpm typecheck && pnpm lint && pnpm fmt && pnpm build` must all be
      clean on the final commit.

### Dead code / cleanup

- [ ] **`src/cache/bundleInspector.ts` header comment** still says "alongside
      the WebLLM and Transformers inspectors" — drop the Transformers mention
      (file already gone).
- [ ] **`graph-rag-sample.json`** — untracked dev scratch in repo root. Move
      to `.opensona/` or delete.
- [ ] **`GRAPH.md` + `GRAPH_HUMAN.md`** — kept on this branch for review
      context only, must not land on main. Delete before merge.
- [ ] **`.opensona/verify-cases.json`** is scheduled for deletion in the
      bundle-refresh commit. Confirm no other script references it.

### Docs

- [ ] Rewrite `docs/RAG_BUILD.md` — pipeline description still says
      `parse → chunk → embed → quantise → pack`. Replace with
      `parse → graph → pack`; update the "what gets built" table (no
      `chunks.json.gz`, `embeddings.i8.bin`, `bm25.json.gz`; now
      `graph-nodes.json.gz`, `graph-edges.json.gz`, `aliases.json.gz`).
- [ ] Rewrite `docs/RAG_QUERY.md` — still describes `bge-small-en-v1.5`
      embed + hybrid dense/BM25/RRF. Replace with resolver → traverse flow
      and the `getTraversalPath` callback contract.
- [ ] Update `docs/UI.md` debug-mode section to document the Resolver +
      Traversal panels (currently describes chunks + scores + sources).
- [ ] Update root `README.md` — tech-stack line ("RAG (hybrid BM25 + dense
      vector retrieval)") and debug-mode blurb ("per-turn RAG diagnostics:
      retrieved chunks, scores, sources…").

## Ship checklist

1. All opensona tests green, coverage gate satisfied, lockfile regenerated.
2. All mikoshidb.net tests green, typecheck + lint + build clean.
3. Manual engram walkthrough recorded (screenshots or notes).
4. opensona `0.2.0` tagged, published dry-run via `pnpm pack` to confirm
   `dist/` + `docs/` + `README.md` are the only artifacts shipped.
5. `GRAPH.md` / `GRAPH_HUMAN.md` / `graph-rag-sample.json` removed.
6. PR description cites the manifest v1 → v2 break and the deleted deps.
