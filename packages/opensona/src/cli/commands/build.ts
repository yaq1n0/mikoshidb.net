// packages/opensona/src/cli/commands/build.ts

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Command } from "commander";
import { parseDump } from "../../build/parse.ts";
import { buildGraph } from "../../build/graph.ts";
import { packGraph } from "../../build/pack-graph.ts";
import { generateCategoryEventMap } from "../../build/prebuild-categories.ts";
import { loadConfig } from "../../config.ts";
import type { Timeline, TimelineMeta } from "../../types.ts";
import { CliError } from "../errors.ts";

function parseJsonFile<T>(raw: string, path: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new CliError(`Failed to parse JSON at ${path}: ${msg}`);
  }
}

function buildTimelineMeta(timeline: Timeline, articleTitle: string): TimelineMeta {
  if (timeline.events.length === 0) {
    return { articleTitle, eventCount: 0, minYear: 0, maxYear: 0 };
  }
  const years = timeline.events.map((e) => e.year);
  return {
    articleTitle,
    eventCount: timeline.events.length,
    minYear: Math.min(...years),
    maxYear: Math.max(...years),
  };
}

export async function run(opts: { config: string; output: string; limit?: number }): Promise<void> {
  const config = await loadConfig(opts.config);

  const timelinePath = join(config.generatedDir, "timeline.json");
  const timelineRaw = await readFile(timelinePath, "utf-8");
  const timeline = parseJsonFile<Timeline>(timelineRaw, timelinePath);

  console.log(`Parsing dump: ${config.dumpPath}`);
  // eslint-disable-next-line prefer-const
  let { articles, redirects } = await parseDump(config.dumpPath);
  if (opts.limit) {
    articles = articles.slice(0, opts.limit);
    console.log(`Parsed ${articles.length} articles (limited), ${redirects.length} redirects`);
  } else {
    console.log(`Parsed ${articles.length} articles, ${redirects.length} redirects`);
  }

  console.log("Generating category map...");
  const categoryMap = generateCategoryEventMap(articles, timeline, config);
  console.log(
    `  mapped=${Object.keys(categoryMap.mapping).length} skipped=${categoryMap.skipped.length}`,
  );

  console.log("Building graph...");
  const graph = buildGraph(articles, redirects, timeline, categoryMap, config);
  console.log(
    `  articles=${graph.nodes.articles.size} sections=${graph.nodes.sections.size} ` +
      `categories=${graph.nodes.categories.size} aliases=${graph.aliases.size} ` +
      `deadLinks=${graph.deadLinkCount}`,
  );

  console.log("Packing graph bundle...");
  const timelineMeta = buildTimelineMeta(timeline, config.timelineArticleTitle);
  const result = await packGraph(graph, { timeline, timelineMeta, config });

  await mkdir(opts.output, { recursive: true });

  const manifestPath = join(opts.output, "manifest.json");
  await writeFile(manifestPath, JSON.stringify(result.manifest, null, 2) + "\n");
  console.log(`  Wrote: ${manifestPath}`);

  for (const file of result.files) {
    const filePath = join(opts.output, file.path);
    await writeFile(filePath, file.data);
    console.log(`  Wrote: ${filePath} (${(file.data.byteLength / 1024).toFixed(1)} KB)`);
  }

  const totalBytes = result.files.reduce((sum, f) => sum + f.data.byteLength, 0);
  const m = result.manifest;
  console.log("\n--- Build Summary ---");
  console.log(`  Articles:   ${m.counts.articles}`);
  console.log(`  Sections:   ${m.counts.sections}`);
  console.log(`  Categories: ${m.counts.categories}`);
  console.log(`  Aliases:    ${m.counts.aliases}`);
  console.log(`  Edges:      ${m.counts.edges}`);
  console.log(`  Events:     ${m.counts.events}`);
  console.log(`  Bundle:     ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  Build date: ${m.buildDate}`);
}

export function register(program: Command): void {
  program
    .command("build")
    .description("Parse dump, build graph, and pack into RAG bundle")
    .requiredOption("--config <path>", "Config JSON path (overrides config.default.json)")
    .requiredOption("--output <dir>", "Output directory for bundle files")
    .option("--limit <n>", "Only process the first N articles (for fast partial builds)", parseInt)
    .action(run);
}
