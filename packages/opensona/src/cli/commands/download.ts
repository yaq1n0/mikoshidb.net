// packages/opensona/src/cli/commands/download.ts

import { mkdir, stat, rename, rm } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import type { Command } from "commander";
import _7z from "7zip-min";
import { CliError } from "../errors.ts";

export function dumpUrl(wiki: string): string {
  if (!/^[a-z0-9-]+$/i.test(wiki) || wiki.length < 1) {
    throw new CliError(`Invalid wiki subdomain: ${wiki}`);
  }
  const lower = wiki.toLowerCase();
  const a = lower[0];
  const ab = lower.slice(0, Math.min(2, lower.length));
  return `https://s3.amazonaws.com/wikia_xml_dumps/${a}/${ab}/${lower}_pages_current.xml.7z`;
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

  const url = dumpUrl(opts.wiki);
  console.log(`Wiki: ${opts.wiki}.fandom.com`);
  console.log(`Source: ${url}`);

  const resp = await fetch(url);
  if (!resp.ok) {
    throw new CliError(`Could not download dump from ${url} (HTTP ${resp.status})`);
  }
  if (!resp.body) {
    throw new CliError(`Empty response body from ${url}`);
  }

  const lastModified = resp.headers.get("last-modified") ?? "unknown";
  const totalBytes = Number(resp.headers.get("content-length") ?? 0);
  console.log(`Last-Modified: ${lastModified}`);
  console.log(`Size: ${(totalBytes / 1024 / 1024).toFixed(1)} MB compressed`);

  await mkdir(dirname(opts.output), { recursive: true });
  const workDir = await mkdtempScratch();
  const archivePath = join(workDir, "dump.xml.7z");

  console.log("Downloading...");
  await pipeline(
    Readable.fromWeb(resp.body as unknown as Parameters<typeof Readable.fromWeb>[0]),
    createWriteStream(archivePath),
  );

  console.log("Decompressing...");
  await _7z.unpack(archivePath, workDir);

  const extractedName = `${opts.wiki.toLowerCase()}_pages_current.xml`;
  const extractedPath = join(workDir, extractedName);
  try {
    await stat(extractedPath);
  } catch {
    throw new CliError(`Expected ${extractedName} in archive but it was not found`);
  }

  await rename(extractedPath, opts.output).catch(async (err: NodeJS.ErrnoException) => {
    // rename across filesystems fails with EXDEV — fall back to copy+unlink
    if (err.code !== "EXDEV") throw err;
    const { copyFile, unlink } = await import("node:fs/promises");
    await copyFile(extractedPath, opts.output);
    await unlink(extractedPath);
  });

  await rm(workDir, { recursive: true, force: true });

  const finalStat = await stat(opts.output);
  console.log(`\nDump saved to ${opts.output} (${(finalStat.size / 1024 / 1024).toFixed(1)} MB)`);
}

async function mkdtempScratch(): Promise<string> {
  const { mkdtemp } = await import("node:fs/promises");
  return mkdtemp(join(tmpdir(), "opensona-dump-"));
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
