import { describe, expect, it } from "vitest";
import { parse } from "@/terminal/parser";

describe("parse", () => {
  it("returns null for empty / whitespace input", () => {
    expect(parse("")).toBeNull();
    expect(parse("   ")).toBeNull();
  });

  it("parses a bare command", () => {
    expect(parse("help")).toEqual({
      command: "help",
      args: [],
      raw: "help",
    });
  });

  it("lowercases the leading command", () => {
    const result = parse("HELP");
    expect(result?.command).toBe("help");
  });

  it("preserves arg casing", () => {
    const result = parse("info engram V");
    expect(result?.args).toEqual(["engram", "V"]);
  });

  it("supports double-quoted multi-word args", () => {
    const result = parse('load "some model"');
    expect(result?.command).toBe("load");
    expect(result?.args).toEqual(["some model"]);
  });

  it("tolerates unclosed quotes by flushing the buffer at end", () => {
    const result = parse('a "b c');
    expect(result?.command).toBe("a");
    expect(result?.args).toEqual(["b c"]);
  });

  it("collapses runs of whitespace", () => {
    const result = parse("ls   firmware");
    expect(result?.command).toBe("ls");
    expect(result?.args).toEqual(["firmware"]);
  });
});
