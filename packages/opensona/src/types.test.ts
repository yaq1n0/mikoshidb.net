import { describe, it, expect } from "vitest";
import { EditionEraSchema, OpensonaConfigSchema } from "./types.ts";

const baseConfig = {
  dumpPath: ".opensona/downloads/dump.xml",
  generatedDir: ".opensona/generated",
  source: "https://example.fandom.com",
  license: "CC-BY-SA-3.0",
  graph: {
    sectionMaxChars: 2000,
    leadMaxChars: 600,
    dropDeadLinks: true,
    includeMentionsEdges: true,
  },
  maxBundleBytes: 52428800,
  timelineArticleTitle: "Timeline",
  timelineValidation: {
    minYearHeadings: 1,
    minEvents: 10,
  },
  editionEras: [],
  categorySkip: {
    prefixes: [],
    suffixes: [],
    exact: [],
  },
};

describe("EditionEraSchema", () => {
  it("fails refine when startYear > endYear", () => {
    expect(() =>
      EditionEraSchema.parse({
        prefix: "2020",
        label: "Era",
        startYear: 2025,
        endYear: 2020,
      }),
    ).toThrow();
  });

  it("accepts equal start and end years", () => {
    const out = EditionEraSchema.parse({
      prefix: "2020",
      label: "Era",
      startYear: 2020,
      endYear: 2020,
    });
    expect(out.startYear).toBe(2020);
  });

  it("rejects empty prefix", () => {
    expect(() =>
      EditionEraSchema.parse({
        prefix: "",
        label: "Era",
        startYear: 2020,
        endYear: 2025,
      }),
    ).toThrow();
  });

  it("rejects empty label", () => {
    expect(() =>
      EditionEraSchema.parse({
        prefix: "2020",
        label: "",
        startYear: 2020,
        endYear: 2025,
      }),
    ).toThrow();
  });

  it("rejects extra keys via .strict()", () => {
    expect(() =>
      EditionEraSchema.parse({
        prefix: "2020",
        label: "Era",
        startYear: 2020,
        endYear: 2025,
        extra: "no",
      }),
    ).toThrow();
  });
});

describe("OpensonaConfigSchema", () => {
  it("validates a minimal valid config", () => {
    expect(() => OpensonaConfigSchema.parse(baseConfig)).not.toThrow();
  });

  it("rejects non-URL source", () => {
    expect(() => OpensonaConfigSchema.parse({ ...baseConfig, source: "not-a-url" })).toThrow();
  });

  it("rejects non-positive leadMaxChars", () => {
    expect(() =>
      OpensonaConfigSchema.parse({
        ...baseConfig,
        graph: { ...baseConfig.graph, leadMaxChars: 0 },
      }),
    ).toThrow();
  });

  it("rejects non-positive sectionMaxChars", () => {
    expect(() =>
      OpensonaConfigSchema.parse({
        ...baseConfig,
        graph: { ...baseConfig.graph, sectionMaxChars: -1 },
      }),
    ).toThrow();
  });

  it("rejects non-positive maxBundleBytes", () => {
    expect(() => OpensonaConfigSchema.parse({ ...baseConfig, maxBundleBytes: 0 })).toThrow();
  });

  it("accepts zero for timelineValidation (nonnegative)", () => {
    expect(() =>
      OpensonaConfigSchema.parse({
        ...baseConfig,
        timelineValidation: { minYearHeadings: 0, minEvents: 0 },
      }),
    ).not.toThrow();
  });

  it("rejects negative timelineValidation.minYearHeadings", () => {
    expect(() =>
      OpensonaConfigSchema.parse({
        ...baseConfig,
        timelineValidation: { minYearHeadings: -1, minEvents: 0 },
      }),
    ).toThrow();
  });

  it("rejects malformed categorySkip", () => {
    expect(() =>
      OpensonaConfigSchema.parse({
        ...baseConfig,
        categorySkip: { prefixes: "wrong", suffixes: [], exact: [] },
      }),
    ).toThrow();
  });

  it("rejects extra top-level keys", () => {
    expect(() => OpensonaConfigSchema.parse({ ...baseConfig, bogus: 1 })).toThrow();
  });
});
