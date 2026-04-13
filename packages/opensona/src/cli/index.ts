#!/usr/bin/env node
import { Command } from "commander";
import { CliError } from "./errors.ts";
import { register as registerDownload } from "./commands/download.ts";
import { register as registerPrebuild } from "./commands/prebuild.ts";
import { register as registerBuild } from "./commands/build.ts";
import { register as registerVerify } from "./commands/verify.ts";

export const buildProgram = (): Command => {
  const program = new Command();

  program
    .name("opensona")
    .description("RAG build & query toolkit for wiki-grounded LLM personas")
    .version("0.1.0");

  registerDownload(program);
  registerPrebuild(program);
  registerBuild(program);
  registerVerify(program);

  return program;
};

export const main = async (argv?: readonly string[]): Promise<void> => {
  const program = buildProgram();
  try {
    await program.parseAsync(argv as string[] | undefined);
  } catch (err) {
    if (err instanceof CliError) {
      console.error(`Error: ${err.message}`);
      process.exitCode = err.exitCode;
    } else {
      throw err;
    }
  }
};

// Only auto-run when invoked directly (not when imported in tests).
// import.meta.url is the file URL; process.argv[1] is the entry script path.
const isDirectRun =
  typeof process !== "undefined" &&
  process.argv[1] &&
  import.meta.url === `file://${process.argv[1]}`;

if (isDirectRun) {
  await main();
}
