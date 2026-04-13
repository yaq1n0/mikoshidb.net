// packages/opensona/src/cli/commands/prebuild.ts

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Command } from "commander";
import { parseDump } from "../../build/parse.ts";
import { generateTimeline } from "../../build/timeline.ts";
import { generateCategoryEventMap } from "../../build/prebuild-categories.ts";
import { loadConfig } from "../../config.ts";
import { CliError } from "../errors.ts";

export async function run(opts: { config: string; output: string }): Promise<void> {
  const config = await loadConfig(opts.config);

  console.log(`Parsing dump: ${config.dumpPath}`);

  const timelineTitle = config.timelineArticleTitle;
  const { articles } = await parseDump(config.dumpPath, new Set([timelineTitle]));
  console.log(`Parsed ${articles.length} articles`);

  const timelineTitleLower = timelineTitle.toLowerCase();
  const timelineArticle = articles.find(
    (a) => a.title === timelineTitle || a.title.toLowerCase() === timelineTitleLower,
  );

  if (!timelineArticle) {
    throw new CliError(
      `Could not find the '${timelineTitle}' article in the dump. ` +
        `Ensure the dump contains an article titled '${timelineTitle}'.`,
    );
  }

  console.log("Generating timeline...");
  const timeline = generateTimeline(timelineArticle, config);
  console.log(`Generated ${timeline.events.length} timeline events`);

  console.log("Generating category map...");
  const categoryMap = generateCategoryEventMap(articles, timeline, config);
  const mappedCount = Object.keys(categoryMap.mapping).length;
  const skippedCount = categoryMap.skipped.length;
  console.log(`Mapped ${mappedCount} categories, skipped ${skippedCount}`);

  await mkdir(opts.output, { recursive: true });

  const timelinePath = join(opts.output, "timeline.json");
  const categoryMapPath = join(opts.output, "category-map.json");

  await writeFile(timelinePath, JSON.stringify(timeline, null, 2) + "\n");
  await writeFile(categoryMapPath, JSON.stringify(categoryMap, null, 2) + "\n");

  console.log(`\nWrote: ${timelinePath}`);
  console.log(`Wrote: ${categoryMapPath}`);

  if (config.editionEras.length > 0) {
    console.log("\n--- Era breakdown ---");
    for (const era of config.editionEras) {
      const count = timeline.events.filter(
        (e) => e.year >= era.startYear && e.year <= era.endYear,
      ).length;
      console.log(`  ${era.label}: ${count} events`);
    }

    const otherCount = timeline.events.filter((e) => {
      return !config.editionEras.some((era) => e.year >= era.startYear && e.year <= era.endYear);
    }).length;
    if (otherCount > 0) {
      console.log(`  Other years: ${otherCount} events`);
    }
  }

  console.log(`\nTotal: ${timeline.events.length} events, ${mappedCount} mapped categories`);
}

export function register(program: Command): void {
  program
    .command("prebuild")
    .description("Generate timeline + category map from wiki dump")
    .requiredOption("--config <path>", "Config JSON path (overrides config.default.json)")
    .requiredOption("--output <dir>", "Output directory for generated files")
    .action(run);
}
