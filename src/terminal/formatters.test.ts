import { describe, expect, it } from "vitest";
import { formatProgressBar, pad } from "@/terminal/formatters";

describe("pad", () => {
  it("pads shorter strings to the target width", () => {
    expect(pad("x", 4)).toBe("x   ");
  });

  it("slices strings longer than the target width", () => {
    expect(pad("longer", 3)).toBe("lon");
  });

  it("returns the string unchanged when exactly at the target width", () => {
    expect(pad("abcd", 4)).toBe("abcd");
  });
});

describe("formatProgressBar", () => {
  it("renders an empty bar at 0%", () => {
    expect(formatProgressBar(0, "init")).toBe(`[${"-".repeat(20)}]   0%  init`);
  });

  it("splits fill/empty at 50%", () => {
    expect(formatProgressBar(0.5, "x")).toBe(`[${"#".repeat(10)}${"-".repeat(10)}]  50%  x`);
  });

  it("renders a full bar at 100%", () => {
    expect(formatProgressBar(1, "done")).toBe(`[${"#".repeat(20)}] 100%  done`);
  });

  it("clamps out-of-range input", () => {
    expect(formatProgressBar(-0.2, "a")).toBe(`[${"-".repeat(20)}]   0%  a`);
    expect(formatProgressBar(1.4, "b")).toBe(`[${"#".repeat(20)}] 100%  b`);
  });

  it("truncates labels longer than 60 chars", () => {
    const long = "x".repeat(80);
    expect(formatProgressBar(0, long).endsWith("x".repeat(60))).toBe(true);
  });
});
