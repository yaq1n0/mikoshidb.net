// packages/opensona/src/cli/commands/build.ts

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Command } from "commander";
import { parseDump } from "../../build/parse.ts";
import { chunkArticles } from "../../build/chunk.ts";
import { embedChunks } from "../../build/embed.ts";
import { packBundle } from "../../build/pack.ts";
import { loadConfig } from "../../config.ts";
import type { Timeline } from "../../types.ts";
import type { CategoryEventMap } from "../../build/prebuild-categories.ts";
import { CliError } from "../errors.ts";

function parseJsonFile<T>(raw: string, path: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new CliError(`Failed to parse JSON at ${path}: ${msg}`);
  }
}

export async function run(opts: { config: string; output: string; limit?: number }): Promise<void> {
  const config = await loadConfig(opts.config);

  const timelinePath = join(config.generatedDir, "timeline.json");
  const timelineRaw = await readFile(timelinePath, "utf-8");
  const timeline = parseJsonFile<Timeline>(timelineRaw, timelinePath);

  const categoryMapPath = join(config.generatedDir, "category-map.json");
  const categoryMapRaw = await readFile(categoryMapPath, "utf-8");
  const categoryMap = parseJsonFile<CategoryEventMap>(categoryMapRaw, categoryMapPath);

  console.log(`Parsing dump: ${config.dumpPath}`);
  let articles = await parseDump(config.dumpPath);
  if (opts.limit) {
    articles = articles.slice(0, opts.limit);
    console.log(`Parsed ${articles.length} articles (limited from full set)`);
  } else {
    console.log(`Parsed ${articles.length} articles`);
  }

  console.log("Chunking articles...");
  const chunks = chunkArticles(
    articles,
    { categoryEventMap: categoryMap.mapping, timeline },
    config,
  );
  console.log(`Generated ${chunks.length} chunks`);

  console.log(`Embedding chunks with ${config.embedder.model}...`);
  const { vectors, dim } = await embedChunks(chunks, config, (done, total) => {
    const pct = ((done / total) * 100).toFixed(1);
    process.stdout.write(`\r  Embedding progress: ${done}/${total} (${pct}%)`);
  });
  console.log("\n  Embedding complete");

  console.log("Packing bundle...");
  const result = await packBundle(chunks, vectors, dim, timeline, config);

  await mkdir(opts.output, { recursive: true });
  for (const file of result.files) {
    const filePath = join(opts.output, file.path);
    await writeFile(filePath, file.data);
    console.log(`  Wrote: ${filePath} (${(file.data.length / 1024).toFixed(1)} KB)`);
  }

  const totalBytes = result.files.reduce((sum, f) => sum + f.data.length, 0);
  const m = result.manifest;
  console.log("\n--- Build Summary ---");
  console.log(`  Articles:  ${m.counts.articles}`);
  console.log(`  Chunks:    ${m.counts.chunks}`);
  console.log(`  Events:    ${m.counts.events}`);
  console.log(`  Embedder:  ${m.embedder.model} (dim=${m.embedder.dim})`);
  console.log(`  Bundle:    ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  Build date: ${m.buildDate}`);
}

export function register(program: Command): void {
  program
    .command("build")
    .description("Parse, chunk, embed, and pack wiki dump into RAG bundle")
    .requiredOption("--config <path>", "Config JSON path (overrides config.default.json)")
    .requiredOption("--output <dir>", "Output directory for bundle files")
    .option("--limit <n>", "Only process the first N articles (for fast partial builds)", parseInt)
    .action(run);
}
