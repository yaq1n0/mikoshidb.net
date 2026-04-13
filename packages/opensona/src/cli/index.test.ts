import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CliError } from "./errors.ts";

// Mock every command registrar so we can install a single fake command that
// throws whatever we want. The top-level index just wires these up.
const downloadAction = vi.fn();
const prebuildAction = vi.fn();
const buildAction = vi.fn();
const verifyAction = vi.fn();

vi.mock("./commands/download.ts", () => ({
  register(program: import("commander").Command) {
    program.command("download").action(downloadAction);
  },
}));
vi.mock("./commands/prebuild.ts", () => ({
  register(program: import("commander").Command) {
    program.command("prebuild").action(prebuildAction);
  },
}));
vi.mock("./commands/build.ts", () => ({
  register(program: import("commander").Command) {
    program.command("build").action(buildAction);
  },
}));
vi.mock("./commands/verify.ts", () => ({
  register(program: import("commander").Command) {
    program.command("verify").action(verifyAction);
  },
}));

describe("cli/index main()", () => {
  let errSpy: ReturnType<typeof vi.spyOn>;
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    downloadAction.mockReset();
    prebuildAction.mockReset();
    buildAction.mockReset();
    verifyAction.mockReset();
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = undefined;
  });

  afterEach(() => {
    errSpy.mockRestore();
    process.exitCode = originalExitCode;
  });

  it("catches a CliError, logs 'Error: <msg>', and sets process.exitCode", async () => {
    downloadAction.mockImplementation(() => {
      throw new CliError("bad wiki", 7);
    });

    const { main } = await import("./index.ts");
    await main(["node", "opensona", "download"]);

    expect(errSpy).toHaveBeenCalledWith("Error: bad wiki");
    expect(process.exitCode).toBe(7);
  });

  it("re-throws non-CliError errors", async () => {
    prebuildAction.mockImplementation(() => {
      throw new Error("unexpected");
    });

    const { main } = await import("./index.ts");
    await expect(main(["node", "opensona", "prebuild"])).rejects.toThrow("unexpected");
    // exitCode should NOT be set for non-CliError
    expect(process.exitCode).toBeUndefined();
  });

  it("buildProgram() registers all four commands", async () => {
    const { buildProgram } = await import("./index.ts");
    const program = buildProgram();
    const names = program.commands.map((c) => c.name()).sort();
    expect(names).toEqual(["build", "download", "prebuild", "verify"]);
  });
});
