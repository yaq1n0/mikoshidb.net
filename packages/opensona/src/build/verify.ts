// packages/opensona/src/build/verify.ts
// Graph-bundle verification. Three layers:
//   1. Integrity — always. Every edge resolves, aliases point at real articles,
//      node eventIds resolve against the timeline.
//   2. Alias-only retrieval — deterministic, no LLM. Caller provides an alias
//      string; we synthesize a `TraversalDirective` directly and run traverse().
//   3. LLM-resolver retrieval — optional (`--with-llm`). Caller wires a test
//      `getTraversalPath`. Skipped here; exposed through the CLI runner.

import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";
import type { CharacterContext, Manifest, TraversalDirective } from "../types.ts";
import {
  hydrateGraph,
  type LoadedGraph,
  type RawEdgesPayload,
  type RawNodesPayload,
} from "../runtime/graph.ts";
import { traverse } from "../runtime/traverse.ts";

export interface IntegrityReport {
  articleCount: number;
  sectionCount: number;
  categoryCount: number;
  aliasCount: number;
  edgeCount: number;
  dangling: {
    edgeSrc: string[];
    edgeDst: string[];
    aliasTarget: string[];
    sectionArticle: string[];
    categoryArticle: string[];
    nodeEventIds: string[];
  };
  passed: boolean;
}

export interface GraphVerifyCase {
  id: string;
  query: string;
  layer: "alias";
  alias?: string;
  aliases?: string[];
  neighbors?: "none" | "direct" | "two_hop";
  includeCategories?: string[];
  characterContext: CharacterContext;
  /** All of these article ids must appear in the retrieved chunks. */
  expectArticleIds?: string[];
  /** At least one of these must appear. */
  expectAny?: string[];
  /** None of these may appear. */
  mustNotArticleIds?: string[];
  /** Retrieval should return zero chunks. */
  expectEmpty?: boolean;
  /**
   * Verify that every returned chunk's `latestEventOrder` is <= the cutoff
   * order implied by `characterContext.cutoffEventId`.
   */
  assertNoPostCutoff?: boolean;
  /** If true, a failure is recorded but does not count toward the failure total. */
  allowFailure?: boolean;
}

export interface CaseResult {
  id: string;
  layer: "alias" | "llm";
  passed: boolean;
  allowedFailure: boolean;
  chunks: Array<{ id: string; articleId: string; header: string; hops: number }>;
  failures: string[];
}

export interface VerifyReport {
  integrity: IntegrityReport;
  cases: CaseResult[];
  /** PASS/FAIL aggregate ignoring `allowFailure`. */
  blocked: boolean;
}

async function loadBundle(bundleDir: string): Promise<{ manifest: Manifest; graph: LoadedGraph }> {
  const manifestRaw = await readFile(join(bundleDir, "manifest.json"), "utf-8");
  const manifest = JSON.parse(manifestRaw) as Manifest;
  if (manifest.version !== 2 || manifest.retrieval !== "graph") {
    throw new Error(
      `verify: unsupported bundle (version=${manifest.version}, retrieval=${manifest.retrieval}); expected v2/graph`,
    );
  }

  const [nodesGz, edgesGz, aliasesGz] = await Promise.all([
    readFile(join(bundleDir, "graph-nodes.json.gz")),
    readFile(join(bundleDir, "graph-edges.json.gz")),
    readFile(join(bundleDir, "aliases.json.gz")),
  ]);
  const nodes = JSON.parse(gunzipSync(nodesGz).toString("utf-8")) as RawNodesPayload;
  const edges = JSON.parse(gunzipSync(edgesGz).toString("utf-8")) as RawEdgesPayload;
  const aliases = JSON.parse(gunzipSync(aliasesGz).toString("utf-8")) as Record<string, string>;

  const graph = hydrateGraph(manifest, nodes, edges, aliases);
  return { manifest, graph };
}

export function verifyIntegrity(graph: LoadedGraph): IntegrityReport {
  const dangling: IntegrityReport["dangling"] = {
    edgeSrc: [],
    edgeDst: [],
    aliasTarget: [],
    sectionArticle: [],
    categoryArticle: [],
    nodeEventIds: [],
  };

  // Alias targets must be articles.
  for (const [alias, target] of graph.aliases) {
    if (!graph.articles.has(target)) {
      dangling.aliasTarget.push(`${alias} -> ${target}`);
    }
  }

  // Sections reference their articles.
  for (const [sid, sec] of graph.sections) {
    if (!graph.articles.has(sec.articleId)) {
      dangling.sectionArticle.push(`${sid} -> ${sec.articleId}`);
    }
  }

  // Categories reference their articles.
  for (const [cid, cat] of graph.categories) {
    for (const a of cat.articleIds) {
      if (!graph.articles.has(a)) {
        dangling.categoryArticle.push(`${cid} -> ${a}`);
      }
    }
  }

  // Every link edge endpoint is an article.
  let edgeCount = 0;
  for (const [src, dsts] of graph.edges.links) {
    if (!graph.articles.has(src)) dangling.edgeSrc.push(`links:${src}`);
    for (const d of dsts) {
      edgeCount++;
      if (!graph.articles.has(d)) dangling.edgeDst.push(`links:${src}->${d}`);
    }
  }

  // Node eventIds must all resolve against the timeline.
  for (const [aid, a] of graph.articles) {
    for (const e of a.eventIds) {
      if (!graph.eventOrder.has(e)) {
        dangling.nodeEventIds.push(`article:${aid}:${e}`);
      }
    }
  }
  for (const [sid, s] of graph.sections) {
    for (const e of s.eventIds) {
      if (!graph.eventOrder.has(e)) {
        dangling.nodeEventIds.push(`section:${sid}:${e}`);
      }
    }
  }

  const hasIssues =
    dangling.edgeSrc.length > 0 ||
    dangling.edgeDst.length > 0 ||
    dangling.aliasTarget.length > 0 ||
    dangling.sectionArticle.length > 0 ||
    dangling.categoryArticle.length > 0 ||
    dangling.nodeEventIds.length > 0;

  return {
    articleCount: graph.articles.size,
    sectionCount: graph.sections.size,
    categoryCount: graph.categories.size,
    aliasCount: graph.aliases.size,
    edgeCount,
    dangling,
    passed: !hasIssues,
  };
}

function runAliasCase(testCase: GraphVerifyCase, graph: LoadedGraph): CaseResult {
  const failures: string[] = [];

  const entities: string[] = testCase.aliases
    ? [...testCase.aliases]
    : testCase.alias
      ? [testCase.alias]
      : [];
  if (entities.length === 0) {
    failures.push("alias layer: no `alias` or `aliases` provided");
  }

  const directive: TraversalDirective = {
    entities,
    neighbors: testCase.neighbors ?? "direct",
    include_categories: testCase.includeCategories ?? [],
  };

  const { chunks, trace } = traverse(directive, graph, testCase.characterContext);

  const gotArticleIds = new Set(chunks.map((c) => c.chunk.articleId));

  if (testCase.expectEmpty) {
    if (chunks.length > 0) {
      failures.push(
        `expected empty retrieval, got ${chunks.length} chunk(s) from ${[...gotArticleIds].join(", ")}`,
      );
    }
  }

  if (testCase.expectArticleIds) {
    for (const id of testCase.expectArticleIds) {
      if (!gotArticleIds.has(id)) {
        failures.push(`expected article "${id}" in retrieval, not found`);
      }
    }
  }

  if (testCase.expectAny && testCase.expectAny.length > 0) {
    const hit = testCase.expectAny.some((id) => gotArticleIds.has(id));
    if (!hit) {
      failures.push(
        `expected at least one of [${testCase.expectAny.join(", ")}], got [${[...gotArticleIds].join(", ")}]`,
      );
    }
  }

  if (testCase.mustNotArticleIds) {
    for (const id of testCase.mustNotArticleIds) {
      if (gotArticleIds.has(id)) {
        failures.push(`article "${id}" must not appear but was retrieved`);
      }
    }
  }

  if (testCase.assertNoPostCutoff) {
    const cutoffId = testCase.characterContext.cutoffEventId;
    const cutoffOrder =
      !cutoffId || cutoffId === "__LAST_EVENT__"
        ? Infinity
        : (graph.eventOrder.get(cutoffId) ?? Infinity);
    for (const rc of chunks) {
      const lo = rc.chunk.latestEventOrder;
      if (lo !== -1 && lo > cutoffOrder) {
        failures.push(`chunk ${rc.chunk.id} latestEventOrder=${lo} exceeds cutoff=${cutoffOrder}`);
      }
    }
  }

  // Unresolved-alias warnings surface as failures only when the case expected
  // a concrete article — otherwise treat them as benign (the resolver tried
  // an alias and the graph had no match; `expectEmpty` paths rely on this).
  if (
    (testCase.expectArticleIds?.length ?? 0) > 0 &&
    trace.unresolvedEntities.length > 0 &&
    chunks.length === 0
  ) {
    failures.push(`no entities resolved (unresolved: ${trace.unresolvedEntities.join(", ")})`);
  }

  const passed = failures.length === 0;
  return {
    id: testCase.id,
    layer: "alias",
    passed,
    allowedFailure: testCase.allowFailure === true,
    chunks: chunks.slice(0, 5).map((rc) => ({
      id: rc.chunk.id,
      articleId: rc.chunk.articleId,
      header: rc.chunk.header,
      hops: rc.hops,
    })),
    failures,
  };
}

export async function verifyBundle(
  bundleDir: string,
  cases: GraphVerifyCase[],
  onProgress?: (done: number, total: number) => void,
): Promise<VerifyReport> {
  const { graph } = await loadBundle(bundleDir);

  const integrity = verifyIntegrity(graph);

  const results: CaseResult[] = [];
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i]!;
    if (c.layer === "alias") {
      results.push(runAliasCase(c, graph));
    } else {
      results.push({
        id: c.id,
        layer: "alias",
        passed: false,
        allowedFailure: true,
        chunks: [],
        failures: [`unsupported layer "${c.layer}" (CLI --with-llm not wired)`],
      });
    }
    onProgress?.(i + 1, cases.length);
  }

  const blocked = !integrity.passed || results.some((r) => !r.passed && !r.allowedFailure);

  return { integrity, cases: results, blocked };
}
