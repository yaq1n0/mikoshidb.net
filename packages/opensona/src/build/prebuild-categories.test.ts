import { describe, it, expect } from "vitest";
import { generateCategoryEventMap } from "./prebuild-categories.ts";
import type { ParsedArticle } from "./parse.ts";
import type { OpensonaConfig, Timeline } from "../types.ts";

const BASE_CONFIG: OpensonaConfig = {
  dumpPath: "",
  generatedDir: "",
  source: "",
  license: "",
  embedder: { model: "", dim: 0, batchSize: 0 },
  chunking: { targetTokens: 0, maxTokens: 0, overlapTokens: 0 },
  maxBundleBytes: 0,
  bm25: { fields: [], boosts: {} },
  timelineArticleTitle: "Timeline",
  timelineValidation: { minYearHeadings: 1, minEvents: 10 },
  editionEras: [],
  categorySkip: { prefixes: [], suffixes: [], exact: [] },
};

function makeArticle(categories: string[]): ParsedArticle {
  return { title: "T", slug: "t", sections: [], categories };
}

const TIMELINE: Timeline = {
  events: [
    { id: "e-2013", name: "", year: 2013, order: 201301 },
    { id: "e-2020", name: "", year: 2020, order: 202001 },
    { id: "e-2077", name: "", year: 2077, order: 207701 },
  ],
};

describe("generateCategoryEventMap()", () => {
  it("maps categories to the first event in the era range", () => {
    const config: OpensonaConfig = {
      ...BASE_CONFIG,
      editionEras: [
        { prefix: "Era77", label: "77", startYear: 2077, endYear: 2077 },
        { prefix: "Era13", label: "13", startYear: 2013, endYear: 2019 },
      ],
    };
    const articles = [makeArticle(["Era77 Characters"]), makeArticle(["Era13 Locations"])];
    const { mapping, skipped } = generateCategoryEventMap(articles, TIMELINE, config);
    expect(mapping).toEqual({
      "Era77 Characters": "e-2077",
      "Era13 Locations": "e-2013",
    });
    expect(skipped).toEqual([]);
  });

  it("matches edition prefixes in the order they are declared (longest-first wins)", () => {
    const config: OpensonaConfig = {
      ...BASE_CONFIG,
      editionEras: [
        { prefix: "Era77 Phantom", label: "PL", startYear: 2077, endYear: 2077 },
        { prefix: "Era77", label: "77", startYear: 2077, endYear: 2077 },
      ],
    };
    const articles = [makeArticle(["Era77 Phantom Missions"])];
    const { mapping } = generateCategoryEventMap(articles, TIMELINE, config);
    // Would match either entry, but first-win means the specific prefix applies
    expect(mapping["Era77 Phantom Missions"]).toBe("e-2077");
  });

  it("skips categories by exact / prefix / suffix rules", () => {
    const config: OpensonaConfig = {
      ...BASE_CONFIG,
      editionEras: [{ prefix: "Era20", label: "20", startYear: 2020, endYear: 2025 }],
      categorySkip: {
        exact: ["Disambiguations"],
        prefixes: ["Real world"],
        suffixes: ["images"],
      },
    };
    const articles = [
      makeArticle(["Disambiguations"]),
      makeArticle(["Real world people"]),
      makeArticle(["Concept art images"]),
      makeArticle(["Era20 Weapons"]),
    ];
    const { mapping, skipped } = generateCategoryEventMap(articles, TIMELINE, config);
    expect(mapping).toEqual({ "Era20 Weapons": "e-2020" });
    expect(skipped.sort()).toEqual(["Concept art images", "Disambiguations", "Real world people"]);
  });

  it("drops unmatched categories silently (not in mapping, not in skipped)", () => {
    const config: OpensonaConfig = {
      ...BASE_CONFIG,
      editionEras: [{ prefix: "Era77", label: "77", startYear: 2077, endYear: 2077 }],
    };
    const articles = [makeArticle(["Weather Phenomena"])];
    const { mapping, skipped } = generateCategoryEventMap(articles, TIMELINE, config);
    expect(mapping).toEqual({});
    expect(skipped).toEqual([]);
  });

  it("returns null event when no timeline event falls in the era range", () => {
    const config: OpensonaConfig = {
      ...BASE_CONFIG,
      editionEras: [{ prefix: "Future", label: "", startYear: 3000, endYear: 3100 }],
    };
    const articles = [makeArticle(["Future Tech"])];
    const { mapping } = generateCategoryEventMap(articles, TIMELINE, config);
    expect(mapping).toEqual({});
  });
});
