import { describe, it, expect } from "vitest";
import type { OpensonaConfig } from "../types.ts";
import type { ParsedArticle, ParsedSection } from "./parse.ts";
import { generateTimeline } from "./timeline.ts";

const baseConfig = (over?: Partial<OpensonaConfig>): OpensonaConfig =>
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

const mkSection = (heading: string, rawText: string): ParsedSection => ({
  heading,
  text: "",
  rawText,
  links: [],
});

const mkArticle = (sections: ParsedSection[]): ParsedArticle => ({
  title: "Timeline",
  slug: "timeline",
  sections,
  categories: [],
  links: [],
  infobox: {},
});

describe("generateTimeline()", () => {
  it("picks year headings and skips decade/non-year headings", () => {
    const article = mkArticle([
      mkSection("Introduction", "* Should be ignored\n"),
      mkSection("2010s", "* Decade intro ignored\n"),
      mkSection("2013", "* Event A\n"),
      mkSection("2077", "* Event B\n"),
    ]);
    const t = generateTimeline(article, baseConfig());
    expect(t.events).toHaveLength(2);
    expect(t.events.map((e) => e.year)).toEqual([2013, 2077]);
  });

  it("extracts bullets, skips empty bullet lines", () => {
    const article = mkArticle([mkSection("2013", "* First event\n*\n*   \n* Second event\n")]);
    const t = generateTimeline(article, baseConfig());
    expect(t.events.map((e) => e.name)).toEqual(["First event", "Second event"]);
  });

  it("honors explicit '''Month Day''' date in ordering", () => {
    const article = mkArticle([
      mkSection("2013", "* '''March 5''': Dated event with [[V]].\n* Undated event.\n"),
    ]);
    const t = generateTimeline(article, baseConfig());
    const dated = t.events.find((e) => e.name.includes("Dated"))!;
    const undated = t.events.find((e) => e.name.includes("Undated"))!;
    // March 5 → day-of-year 64; round(64/3.66) = 17 → order = 2013*100 + 17.
    expect(dated.order).toBe(2013 * 100 + 17);
    // Undated bullet at index 1 (0-based), undated uses bulletIndex+1 path.
    expect(undated.order).toBe(2013 * 100 + 2);
  });

  it("disambiguates identical bullet names across years via id year suffix", () => {
    const article = mkArticle([
      mkSection("2013", "* Party time with [[V]]\n"),
      mkSection("2020", "* Party time with [[V]]\n"),
    ]);
    const t = generateTimeline(article, baseConfig());
    const ids = t.events.map((e) => e.id);
    expect(ids).toContain("party-time-with-v-2013");
    expect(ids).toContain("party-time-with-v-2020");
  });

  it("strips wiki markup from event name: bold, links, refs", () => {
    const article = mkArticle([
      mkSection(
        "2013",
        "* '''Bold''' intro with [[link|display]] and [[plain]] and <ref>citation text</ref> remainder.\n",
      ),
    ]);
    const t = generateTimeline(article, baseConfig());
    expect(t.events[0].name).toBe("Bold intro with display and plain and remainder.");
  });

  it("truncates names longer than 80 to 77 chars + ellipsis", () => {
    const longText = "a".repeat(200);
    const article = mkArticle([mkSection("2013", `* ${longText}\n`)]);
    const t = generateTimeline(article, baseConfig());
    expect(t.events[0].name.length).toBe(80);
    expect(t.events[0].name.endsWith("...")).toBe(true);
  });

  it("extracts [[wiki]] keywords, excluding File:/Category:", () => {
    const article = mkArticle([
      mkSection("2013", "* Scene with [[V]], [[File:pic.png]], [[Category:X]], [[Johnny]]\n"),
    ]);
    const t = generateTimeline(article, baseConfig());
    expect(t.events[0].keywords).toEqual(["V", "Johnny"]);
  });

  it("omits keywords key when no links present", () => {
    const article = mkArticle([mkSection("2013", "* No links here.\n")]);
    const t = generateTimeline(article, baseConfig());
    expect("keywords" in t.events[0]).toBe(false);
  });

  it("throws when fewer year headings than minYearHeadings", () => {
    const article = mkArticle([mkSection("2013", "* Event\n")]);
    expect(() =>
      generateTimeline(
        article,
        baseConfig({ timelineValidation: { minYearHeadings: 5, minEvents: 0 } }),
      ),
    ).toThrow(/year headings/);
  });

  it("throws when fewer events than minEvents", () => {
    const article = mkArticle([mkSection("2013", "* Only one\n")]);
    expect(() =>
      generateTimeline(
        article,
        baseConfig({ timelineValidation: { minYearHeadings: 0, minEvents: 5 } }),
      ),
    ).toThrow(/events/);
  });

  it("returns events in ascending order", () => {
    const article = mkArticle([
      mkSection("2077", "* Future event\n"),
      mkSection("2013", "* Past event\n"),
    ]);
    const t = generateTimeline(article, baseConfig());
    expect(t.events.map((e) => e.order)).toEqual(
      [...t.events.map((e) => e.order)].sort((a, b) => a - b),
    );
    expect(t.events[0].year).toBe(2013);
    expect(t.events[1].year).toBe(2077);
  });

  it("generates id = slugify(first 60 chars of name) + year suffix", () => {
    const article = mkArticle([mkSection("2013", "* Hello World\n")]);
    const t = generateTimeline(article, baseConfig());
    expect(t.events[0].id).toBe("hello-world-2013");
  });
});
