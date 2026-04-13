// packages/opensona/src/cli/commands/download.ts

import { mkdir, stat } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { dirname } from "node:path";
import type { Command } from "commander";
import { CliError } from "../errors.ts";

export function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function run(opts: { wiki: string; output: string; force?: boolean }): Promise<void> {
  if (!opts.force) {
    try {
      const s = await stat(opts.output);
      if (s.size > 0) {
        console.log(
          `Dump already exists at ${opts.output} (${(s.size / 1024 / 1024).toFixed(1)} MB)`,
        );
        console.log("Use --force to re-download.");
        return;
      }
    } catch {
      // File doesn't exist, proceed with download
    }
  }

  const wikiBase = `https://${opts.wiki}.fandom.com`;
  console.log(`Wiki: ${opts.wiki}.fandom.com`);

  console.log("Verifying wiki...");
  const apiUrl = `${wikiBase}/api.php?action=query&meta=siteinfo&siprop=general&format=json`;
  const siteResp = await fetch(apiUrl);
  if (!siteResp.ok) {
    throw new CliError(`Could not reach ${opts.wiki}.fandom.com (HTTP ${siteResp.status})`);
  }
  const siteInfo = (await siteResp.json()) as {
    query?: { general?: { sitename?: string } };
  };
  const siteName = siteInfo.query?.general?.sitename ?? opts.wiki;
  console.log(`Found wiki: ${siteName}`);

  console.log("Fetching page list...");
  const allTitles: string[] = [];
  let apcontinue: string | undefined;

  do {
    const params = new URLSearchParams({
      action: "query",
      list: "allpages",
      aplimit: "500",
      apnamespace: "0",
      apfilterredir: "nonredirects",
      format: "json",
    });
    if (apcontinue) params.set("apcontinue", apcontinue);

    const resp = await fetch(`${wikiBase}/api.php?${params}`);
    if (!resp.ok) {
      throw new CliError(`Error fetching page list: HTTP ${resp.status}`);
    }

    const data = (await resp.json()) as {
      query?: { allpages?: { title: string }[] };
      continue?: { apcontinue?: string };
    };
    const pages = data.query?.allpages ?? [];
    for (const p of pages) allTitles.push(p.title);

    apcontinue = data.continue?.apcontinue;
    process.stdout.write(`\r  Found ${allTitles.length} pages...`);
  } while (apcontinue);

  console.log(`\n  Total: ${allTitles.length} content pages`);

  console.log("Downloading page content...");
  await mkdir(dirname(opts.output), { recursive: true });

  const batchSize = 50;
  const batches: string[][] = [];
  for (let i = 0; i < allTitles.length; i += batchSize) {
    batches.push(allTitles.slice(i, i + batchSize));
  }

  const outStream = createWriteStream(opts.output);
  outStream.write('<?xml version="1.0" encoding="UTF-8"?>\n');
  outStream.write('<mediawiki xmlns="http://www.mediawiki.org/xml/export-0.11/" xml:lang="en">\n');

  let exportedCount = 0;
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const params = new URLSearchParams({
      action: "query",
      prop: "revisions|categories",
      rvprop: "content",
      rvslots: "main",
      cllimit: "max",
      titles: batch.join("|"),
      format: "json",
      formatversion: "2",
    });

    const resp = await fetch(`${wikiBase}/api.php?${params}`);
    if (!resp.ok) {
      throw new CliError(`Error fetching batch ${i + 1}/${batches.length}: HTTP ${resp.status}`);
    }

    const data = (await resp.json()) as {
      query?: {
        pages?: {
          title: string;
          ns: number;
          missing?: boolean;
          redirect?: boolean;
          revisions?: { slots?: { main?: { content?: string } } }[];
        }[];
      };
    };

    const pages = data.query?.pages ?? [];
    for (const page of pages) {
      if (page.missing) continue;
      const wikitext = page.revisions?.[0]?.slots?.main?.content ?? "";
      if (!wikitext) continue;

      const isRedirect = page.redirect === true;
      outStream.write("  <page>\n");
      outStream.write(`    <title>${escapeXml(page.title)}</title>\n`);
      outStream.write(`    <ns>${page.ns}</ns>\n`);
      if (isRedirect) outStream.write("    <redirect />\n");
      outStream.write("    <revision>\n");
      outStream.write(`      <text>${escapeXml(wikitext)}</text>\n`);
      outStream.write("    </revision>\n");
      outStream.write("  </page>\n");
      exportedCount++;
    }

    process.stdout.write(
      `\r  Downloaded ${exportedCount}/${allTitles.length} pages (batch ${i + 1}/${batches.length})`,
    );
  }

  outStream.write("</mediawiki>\n");
  outStream.end();

  await new Promise<void>((resolve, reject) => {
    outStream.on("finish", resolve);
    outStream.on("error", reject);
  });

  const finalStat = await stat(opts.output);
  console.log(`\n\nDump saved to ${opts.output} (${(finalStat.size / 1024 / 1024).toFixed(1)} MB)`);
  console.log(`Exported ${exportedCount} pages from ${siteName}`);
}

export function register(program: Command): void {
  program
    .command("download")
    .description("Download a Fandom wiki XML dump to .opensona/.cache/dump.xml")
    .requiredOption("--wiki <subdomain>", "Fandom wiki subdomain (e.g. 'cyberpunk')")
    .option("--output <path>", "Output path for dump XML", ".opensona/.cache/dump.xml")
    .option("--force", "Re-download even if dump.xml already exists")
    .action(run);
}
