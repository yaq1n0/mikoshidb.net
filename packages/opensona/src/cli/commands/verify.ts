// packages/opensona/src/cli/commands/verify.ts

import { readFile } from "node:fs/promises";
import type { Command } from "commander";
import { verifyBundle } from "../../build/verify.ts";
import type { GraphVerifyCase } from "../../build/verify.ts";
import { CliError } from "../errors.ts";

export async function run(opts: { cases: string; bundle: string }): Promise<void> {
  const casesRaw = await readFile(opts.cases, "utf-8");
  let cases: GraphVerifyCase[];
  try {
    cases = JSON.parse(casesRaw) as GraphVerifyCase[];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new CliError(`Failed to parse JSON at ${opts.cases}: ${msg}`);
  }

  console.log(`Verifying graph bundle at: ${opts.bundle}`);
  const report = await verifyBundle(opts.bundle, cases, (done, total) => {
    process.stdout.write(`\r  Progress: ${done}/${total} cases`);
  });
  console.log("\n");

  // --- Layer 1: integrity ---
  const { integrity } = report;
  console.log("--- Integrity ---");
  console.log(
    `  articles=${integrity.articleCount} sections=${integrity.sectionCount} categories=${integrity.categoryCount} aliases=${integrity.aliasCount} edges=${integrity.edgeCount}`,
  );
  const d = integrity.dangling;
  if (integrity.passed) {
    console.log("  [+] PASS — no dangling references");
  } else {
    console.log("  [-] FAIL");
    if (d.edgeSrc.length)
      console.log(`    edgeSrc (${d.edgeSrc.length}): ${d.edgeSrc.slice(0, 5).join(", ")}`);
    if (d.edgeDst.length)
      console.log(`    edgeDst (${d.edgeDst.length}): ${d.edgeDst.slice(0, 5).join(", ")}`);
    if (d.aliasTarget.length)
      console.log(
        `    aliasTarget (${d.aliasTarget.length}): ${d.aliasTarget.slice(0, 5).join(", ")}`,
      );
    if (d.sectionArticle.length)
      console.log(
        `    sectionArticle (${d.sectionArticle.length}): ${d.sectionArticle.slice(0, 5).join(", ")}`,
      );
    if (d.categoryArticle.length)
      console.log(
        `    categoryArticle (${d.categoryArticle.length}): ${d.categoryArticle.slice(0, 5).join(", ")}`,
      );
    if (d.nodeEventIds.length)
      console.log(
        `    nodeEventIds (${d.nodeEventIds.length}): ${d.nodeEventIds.slice(0, 5).join(", ")}`,
      );
  }
  console.log("");

  // --- Layer 2: alias cases ---
  console.log("--- Cases (alias layer) ---");
  let pass = 0;
  let fail = 0;
  let softFail = 0;
  for (const r of report.cases) {
    const icon = r.passed ? "[+]" : r.allowedFailure ? "[~]" : "[-]";
    const status = r.passed ? "PASS" : r.allowedFailure ? "SOFT-FAIL" : "FAIL";
    console.log(`${icon} ${status}: ${r.id}`);
    for (const ch of r.chunks) {
      console.log(`    -> ${ch.articleId} ${ch.header} (h${ch.hops})`);
    }
    for (const f of r.failures) {
      console.log(`    !! ${f}`);
    }
    if (r.passed) pass++;
    else if (r.allowedFailure) softFail++;
    else fail++;
  }

  console.log("");
  console.log("--- Verify Summary ---");
  console.log(`  Integrity: ${integrity.passed ? "PASS" : "FAIL"}`);
  console.log(
    `  Cases:     ${pass}/${report.cases.length} passed, ${fail} failed, ${softFail} soft-failed`,
  );

  if (report.blocked) {
    throw new CliError("verify: bundle is not shippable");
  }
}

export function register(program: Command): void {
  program
    .command("verify")
    .description("Graph integrity + alias-retrieval sanity checks")
    .requiredOption("--cases <path>", "Verify cases JSON path")
    .requiredOption("--bundle <dir>", "Bundle directory")
    .action(run);
}
