import { describe, it, expect } from "vitest";
import { generateTimeline } from "./timeline.ts";
import type { ParsedArticle } from "./parse.ts";
import type { OpensonaConfig } from "../types.ts";

const TEST_CONFIG: OpensonaConfig = {
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

function makeTimelineArticle(sections: { heading: string; rawText: string }[]): ParsedArticle {
  return {
    title: "Timeline",
    slug: "timeline",
    sections: sections.map((s) => ({
      heading: s.heading,
      text: "",
      rawText: s.rawText,
    })),
    categories: [],
  };
}

/**
 * Builds a fixture with decade + year headings and bullets, mimicking
 * the Cyberpunk wiki Timeline article structure.
 */
function makeCyberpunkFixture(): ParsedArticle {
  const bullets: string[] = [];
  // Generate 15 bullets across 3 years to pass the >=10 threshold
  for (let i = 0; i < 5; i++) {
    bullets.push(`* Event ${i} involving [[Arasaka]] and [[Night City]].`);
  }

  return makeTimelineArticle([
    { heading: "Introduction", rawText: "Some intro text about the timeline." },
    { heading: "2010s", rawText: "" },
    {
      heading: "2013",
      rawText: bullets.join("\n"),
    },
    { heading: "2020s", rawText: "" },
    {
      heading: "2020",
      rawText: [
        "* '''January 15''': The [[Fourth Corporate War]] begins.",
        "* '''August 20''': [[Arasaka Tower]] is destroyed by a [[nuclear device]].",
        "* An unnamed event with no date.",
        "* Another event involving [[Militech]].",
        "* Yet another event.",
      ].join("\n"),
    },
    { heading: "2070s", rawText: "" },
    {
      heading: "2077",
      rawText: [
        "* '''April 10''': [[V]] arrives in [[Night City]].",
        "* [[Johnny Silverhand]] resurfaces.",
        "* The [[Relic]] malfunction begins.",
        "* [[Dexter DeShawn]] contacts V about a job.",
        "* An economic boom hits Night City.",
      ].join("\n"),
    },
  ]);
}

describe("generateTimeline()", () => {
  it("generates events from year headings under decade headings", () => {
    const article = makeCyberpunkFixture();
    const timeline = generateTimeline(article, TEST_CONFIG);

    // Should have events from all three years: 2013, 2020, 2077
    const years = new Set(timeline.events.map((e) => e.year));
    expect(years).toContain(2013);
    expect(years).toContain(2020);
    expect(years).toContain(2077);

    // Total events: 5 + 5 + 5 = 15
    expect(timeline.events.length).toBe(15);
  });

  it("correctly extracts keywords from [[wiki links]]", () => {
    const article = makeCyberpunkFixture();
    const timeline = generateTimeline(article, TEST_CONFIG);

    // Events from 2013 should have Arasaka and Night City as keywords
    const year2013Events = timeline.events.filter((e) => e.year === 2013);
    for (const event of year2013Events) {
      expect(event.keywords).toContain("Arasaka");
      expect(event.keywords).toContain("Night City");
    }

    // The Fourth Corporate War event should have that keyword
    const corpWarEvent = timeline.events.find((e) => e.name.includes("Fourth Corporate War"));
    expect(corpWarEvent).toBeDefined();
    expect(corpWarEvent!.keywords).toContain("Fourth Corporate War");
  });

  it("correctly parses dates like '''August 20''' for sub-ordering", () => {
    const article = makeCyberpunkFixture();
    const timeline = generateTimeline(article, TEST_CONFIG);

    // The January 15 event should have lower order than August 20 event within 2020
    const janEvent = timeline.events.find((e) => e.name.includes("Fourth Corporate War"));
    const augEvent = timeline.events.find((e) => e.name.includes("Arasaka Tower"));

    expect(janEvent).toBeDefined();
    expect(augEvent).toBeDefined();
    // Both should be in the 2020xx range
    expect(janEvent!.order).toBeGreaterThanOrEqual(202000);
    expect(janEvent!.order).toBeLessThan(202100);
    expect(augEvent!.order).toBeGreaterThanOrEqual(202000);
    expect(augEvent!.order).toBeLessThan(202100);
    // January < August
    expect(janEvent!.order).toBeLessThan(augEvent!.order);
  });

  it("events are sorted by order", () => {
    const article = makeCyberpunkFixture();
    const timeline = generateTimeline(article, TEST_CONFIG);

    for (let i = 1; i < timeline.events.length; i++) {
      expect(timeline.events[i].order).toBeGreaterThanOrEqual(timeline.events[i - 1].order);
    }
  });

  it("throws for articles with no year headings", () => {
    const article = makeTimelineArticle([
      { heading: "Introduction", rawText: "Some text." },
      { heading: "Overview", rawText: "More text." },
    ]);

    expect(() => generateTimeline(article, TEST_CONFIG)).toThrow(
      /Timeline article has 0 year headings/,
    );
  });

  it("throws for articles generating fewer than 10 events", () => {
    const article = makeTimelineArticle([
      { heading: "2020s", rawText: "" },
      {
        heading: "2020",
        rawText: ["* Event one.", "* Event two.", "* Event three."].join("\n"),
      },
    ]);

    expect(() => generateTimeline(article, TEST_CONFIG)).toThrow(
      /Timeline generated only \d+ events/,
    );
  });

  it("parses month-only dates (e.g. '''August''') correctly", () => {
    // '''August''' (no day) should parse as day=1 -> day-of-year ≈ 213
    // sub-order = Math.min(Math.round(213/3.66), 99) = 58
    const bullets: string[] = ["* '''August''': An event happening in August of 2030."];
    for (let i = 0; i < 10; i++) bullets.push(`* Filler event ${i} with [[Arasaka]].`);
    const article = makeTimelineArticle([
      { heading: "2030s", rawText: "" },
      { heading: "2030", rawText: bullets.join("\n") },
    ]);
    const timeline = generateTimeline(article, TEST_CONFIG);
    const augEvent = timeline.events.find((e) => e.name.includes("happening in August"));
    expect(augEvent).toBeDefined();
    // August 1 -> day-of-year 213 -> round(213/3.66) = 58
    expect(augEvent!.order).toBe(2030 * 100 + 58);
  });

  it("does not parse unknown months (falls back to sequential ordering)", () => {
    // '''Smarch''' is not a valid month -> parseExplicitDate returns null
    // so the event uses sequential bullet ordering.
    const bullets = [
      "* '''Smarch 5''': Not a real month, bullet 0.",
      "* '''Octember 10''': Also fake, bullet 1.",
    ];
    for (let i = 0; i < 10; i++) bullets.push(`* Filler event ${i} here.`);
    const article = makeTimelineArticle([
      { heading: "2040s", rawText: "" },
      { heading: "2040", rawText: bullets.join("\n") },
    ]);
    const timeline = generateTimeline(article, TEST_CONFIG);
    const smarch = timeline.events.find((e) => e.name.includes("Not a real month"));
    const octember = timeline.events.find((e) => e.name.includes("Also fake"));
    expect(smarch).toBeDefined();
    expect(octember).toBeDefined();
    // Sequential: first bullet is order 204001, second is 204002
    expect(smarch!.order).toBe(204001);
    expect(octember!.order).toBe(204002);
  });

  it('strips <ref name="x">...</ref> and self-closing <ref/> from event names', () => {
    const bullets = [
      '* A thing happened<ref name="src1">Citation data inside</ref> in the street.',
      '* Another thing occurred<ref name="src2"/> today.',
    ];
    for (let i = 0; i < 10; i++) bullets.push(`* Filler event ${i} here.`);
    const article = makeTimelineArticle([
      { heading: "2050s", rawText: "" },
      { heading: "2050", rawText: bullets.join("\n") },
    ]);
    const timeline = generateTimeline(article, TEST_CONFIG);
    const first = timeline.events.find((e) => e.name.startsWith("A thing happened"));
    const second = timeline.events.find((e) => e.name.startsWith("Another thing occurred"));
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(first!.name).not.toMatch(/<ref/);
    expect(first!.name).not.toMatch(/Citation data/);
    expect(second!.name).not.toMatch(/<ref/);
    // Confirm they read cleanly
    expect(first!.name).toBe("A thing happened in the street.");
    expect(second!.name).toBe("Another thing occurred today.");
  });

  it("truncates event names longer than 80 chars with an ellipsis", () => {
    const longSentence =
      "This is an extraordinarily long event description that goes on and on describing events in painful detail forever more.";
    expect(longSentence.length).toBeGreaterThan(80);
    const bullets = [`* ${longSentence}`];
    for (let i = 0; i < 10; i++) bullets.push(`* Filler event ${i} here.`);
    const article = makeTimelineArticle([
      { heading: "2060s", rawText: "" },
      { heading: "2060", rawText: bullets.join("\n") },
    ]);
    const timeline = generateTimeline(article, TEST_CONFIG);
    const truncated = timeline.events.find((e) => e.name.startsWith("This is an"));
    expect(truncated).toBeDefined();
    expect(truncated!.name.length).toBeLessThanOrEqual(80);
    // Current implementation appends "..." after 77 chars
    expect(truncated!.name.endsWith("...")).toBe(true);
  });

  it("assigns distinct year-suffixed IDs when the same bullet recurs across years", () => {
    const repeatedBullet = "* Most adventures in the series take place here.";
    const fillerA: string[] = [];
    for (let i = 0; i < 5; i++) fillerA.push(`* Unique A event ${i}.`);
    const fillerB: string[] = [];
    for (let i = 0; i < 5; i++) fillerB.push(`* Unique B event ${i}.`);

    const article = makeTimelineArticle([
      { heading: "2013s", rawText: "" },
      {
        heading: "2013",
        rawText: [repeatedBullet, ...fillerA].join("\n"),
      },
      { heading: "2020s", rawText: "" },
      {
        heading: "2020",
        rawText: [repeatedBullet, ...fillerB].join("\n"),
      },
    ]);
    const timeline = generateTimeline(article, TEST_CONFIG);
    const matchingIds = timeline.events
      .filter((e) => e.name.startsWith("Most adventures"))
      .map((e) => e.id);
    expect(matchingIds).toHaveLength(2);
    expect(matchingIds).toContain("most-adventures-in-the-series-take-place-here-2013");
    expect(matchingIds).toContain("most-adventures-in-the-series-take-place-here-2020");
  });
});
