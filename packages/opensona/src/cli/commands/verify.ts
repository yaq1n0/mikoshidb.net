// packages/opensona/src/cli/commands/verify.ts

import { readFile } from "node:fs/promises";
import type { Command } from "commander";
import { verifyBundle } from "../../build/verify.ts";
import type { VerifyCase } from "../../build/verify.ts";
import { CliError } from "../errors.ts";

export async function run(opts: { cases: string; bundle: string }): Promise<void> {
  const casesRaw = await readFile(opts.cases, "utf-8");
  const cases: VerifyCase[] = JSON.parse(casesRaw);

  console.log(`Running ${cases.length} verify cases against: ${opts.bundle}\n`);

  const results = await verifyBundle(opts.bundle, cases, (done, total) => {
    process.stdout.write(`\r  Progress: ${done}/${total} cases`);
  });
  console.log("\n");

  let passCount = 0;
  let failCount = 0;

  for (const result of results) {
    const status = result.passed ? "PASS" : "FAIL";
    const icon = result.passed ? "[+]" : "[-]";
    console.log(`${icon} ${status}: ${result.name}`);
    console.log(`    Query: "${result.query}"`);

    for (const chunk of result.chunks) {
      console.log(`    -> ${chunk.id} (score=${chunk.score.toFixed(4)}) ${chunk.header}`);
      console.log(`       ${chunk.textSnippet}...`);
    }

    if (result.failures.length > 0) {
      for (const failure of result.failures) {
        console.log(`    !! ${failure}`);
      }
    }

    console.log("");

    if (result.passed) {
      passCount++;
    } else {
      failCount++;
    }
  }

  console.log("--- Verify Summary ---");
  console.log(`  Passed: ${passCount}/${results.length}`);
  console.log(`  Failed: ${failCount}/${results.length}`);

  if (failCount > 0) {
    throw new CliError(`${failCount} verify case(s) failed`);
  }
}

export function register(program: Command): void {
  program
    .command("verify")
    .description("Smoke-test retrieval against canned queries")
    .requiredOption("--cases <path>", "Verify cases JSON path")
    .requiredOption("--bundle <dir>", "Bundle directory")
    .action(run);
}
