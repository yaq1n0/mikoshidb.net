import { describe, it, expect } from "vitest";
import type { OpensonaConfig, Timeline } from "../types.ts";
import type { ParsedArticle } from "./parse.ts";
import { generateCategoryEventMap } from "./prebuild-categories.ts";

const cfg = (over: Partial<OpensonaConfig>): OpensonaConfig =>
  ({
    dumpPath: "dump.xml",
    generatedDir: "out",
    source: "https://example.fandom.com",
    license: "CC-BY-SA",
    graph: {
      sectionMaxChars: 2000,
      leadMaxChars: 600,
      dropDeadLinks: true,
      includeMentionsEdges: false,
    },
    maxBundleBytes: 50_000_000,
    timelineArticleTitle: "Timeline",
    timelineValidation: { minYearHeadings: 0, minEvents: 0 },
    editionEras: [],
    categorySkip: { prefixes: [], suffixes: [], exact: [] },
    ...over,
  }) as OpensonaConfig;

const article = (categories: string[]): ParsedArticle => ({
  title: "A",
  slug: "a",
  sections: [],
  categories,
  links: [],
  infobox: {},
});

const timeline: Timeline = {
  events: [
    { id: "e2020", name: "E2020", year: 2020, order: 202001 },
    { id: "e2050", name: "E2050", year: 2050, order: 205001 },
    { id: "e2077", name: "E2077", year: 2077, order: 207701 },
  ],
};

describe("generateCategoryEventMap()", () => {
  it("skips exact-match categories", () => {
    const out = generateCategoryEventMap(
      [article(["Foo", "Skipped"])],
      timeline,
      cfg({
        categorySkip: { prefixes: [], suffixes: [], exact: ["Skipped"] },
        editionEras: [{ prefix: "Foo", label: "L", startYear: 2020, endYear: 2077 }],
      }),
    );
    expect(out.skipped).toContain("Skipped");
    expect(out.mapping.Skipped).toBeUndefined();
  });

  it("skips categories matching a prefix", () => {
    const out = generateCategoryEventMap(
      [article(["StubExtra"])],
      timeline,
      cfg({ categorySkip: { prefixes: ["Stub"], suffixes: [], exact: [] } }),
    );
    expect(out.skipped).toContain("StubExtra");
  });

  it("skips categories matching a lowercase suffix", () => {
    const out = generateCategoryEventMap(
      [article(["Foo BEHIND THE SCENES"])],
      timeline,
      cfg({ categorySkip: { prefixes: [], suffixes: ["behind the scenes"], exact: [] } }),
    );
    expect(out.skipped).toContain("Foo BEHIND THE SCENES");
  });

  it("maps era-prefixed categories to the first event in range", () => {
    const out = generateCategoryEventMap(
      [article(["EraA characters"])],
      timeline,
      cfg({
        editionEras: [{ prefix: "EraA", label: "EraA", startYear: 2020, endYear: 2060 }],
      }),
    );
    expect(out.mapping["EraA characters"]).toBe("e2020");
  });

  it("findFirstEventInRange returns null when no event falls in the range (unmapped)", () => {
    const out = generateCategoryEventMap(
      [article(["EraFuture items"])],
      timeline,
      cfg({
        editionEras: [{ prefix: "EraFuture", label: "F", startYear: 3000, endYear: 4000 }],
      }),
    );
    expect(out.mapping["EraFuture items"]).toBeUndefined();
  });

  it("produces deterministic mapping keys (sorted input iteration)", () => {
    const a1 = article(["EraA x", "EraA a"]);
    const a2 = article(["EraA z"]);
    const out1 = generateCategoryEventMap(
      [a1, a2],
      timeline,
      cfg({ editionEras: [{ prefix: "EraA", label: "A", startYear: 2020, endYear: 2077 }] }),
    );
    const out2 = generateCategoryEventMap(
      [a2, a1],
      timeline,
      cfg({ editionEras: [{ prefix: "EraA", label: "A", startYear: 2020, endYear: 2077 }] }),
    );
    expect(Object.keys(out1.mapping)).toEqual(Object.keys(out2.mapping));
  });
});
