import { describe, it, expect } from "vitest";
import { CliError } from "./errors.ts";

describe("CliError", () => {
  it("defaults exitCode to 1", () => {
    const err = new CliError("boom");
    expect(err.exitCode).toBe(1);
  });

  it("respects a custom exitCode", () => {
    const err = new CliError("boom", 42);
    expect(err.exitCode).toBe(42);
  });

  it("has name 'CliError'", () => {
    const err = new CliError("boom");
    expect(err.name).toBe("CliError");
  });

  it("is an instanceof Error", () => {
    const err = new CliError("boom");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(CliError);
  });

  it("preserves the message", () => {
    const err = new CliError("something broke");
    expect(err.message).toBe("something broke");
  });
});
