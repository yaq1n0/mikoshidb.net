import { describe, it, expect } from "vitest";
import { chunkArticles, splitIntoChunks } from "./chunk.ts";
import type { ChunkingContext } from "./chunk.ts";
import type { ParsedArticle } from "./parse.ts";
import type { OpensonaConfig, Timeline } from "../types.ts";

const TEST_CONFIG: OpensonaConfig = {
  dumpPath: "",
  generatedDir: "",
  source: "",
  license: "",
  embedder: { model: "test/model", dim: 4, batchSize: 32 },
  chunking: { targetTokens: 350, maxTokens: 512, overlapTokens: 50 },
  maxBundleBytes: 150 * 1024 * 1024,
  bm25: { fields: ["title", "header", "text"], boosts: { title: 3, header: 2, text: 1 } },
  timelineArticleTitle: "Timeline",
  timelineValidation: { minYearHeadings: 1, minEvents: 10 },
  editionEras: [],
  categorySkip: { prefixes: [], suffixes: [], exact: [] },
};

function makeArticle(overrides?: Partial<ParsedArticle>): ParsedArticle {
  return {
    title: "Night City",
    slug: "night-city",
    sections: [
      { heading: "", text: "Night City is a megacity in the Free State of California." },
      { heading: "History", text: "Night City was founded by Richard Night in 1994." },
    ],
    categories: ["Locations"],
    ...overrides,
  };
}

function makeTimeline(): Timeline {
  return {
    events: [
      {
        id: "night-city-founded",
        name: "Night City Founded",
        year: 1994,
        order: 199401,
        keywords: ["Night City", "Richard Night"],
      },
      {
        id: "fourth-corporate-war",
        name: "Fourth Corporate War",
        year: 2023,
        order: 202301,
        keywords: ["Arasaka", "Militech"],
      },
      {
        id: "v-arrives",
        name: "V arrives in Night City",
        year: 2077,
        order: 207701,
        keywords: ["V", "Night City"],
      },
    ],
  };
}

function makeContext(overrides?: Partial<ChunkingContext>): ChunkingContext {
  return {
    categoryEventMap: {},
    timeline: makeTimeline(),
    ...overrides,
  };
}

describe("chunkArticles()", () => {
  it("chunks a simple article into expected pieces", () => {
    const article = makeArticle();
    const ctx = makeContext();
    const chunks = chunkArticles([article], ctx, TEST_CONFIG);

    // Two sections -> at least two chunks (text is short, no splitting)
    expect(chunks.length).toBe(2);
    expect(chunks[0].text).toContain("Night City is a megacity");
    expect(chunks[1].text).toContain("founded by Richard Night");
  });

  it("header format is correct: [Title > Section] and [Title] for intro", () => {
    const article = makeArticle();
    const ctx = makeContext();
    const chunks = chunkArticles([article], ctx, TEST_CONFIG);

    // Intro section (empty heading) -> [Title]
    expect(chunks[0].header).toBe("[Night City]");
    // Named section -> [Title > Section]
    expect(chunks[1].header).toBe("[Night City > History]");
  });

  it("event tagging from category map works", () => {
    const article = makeArticle();
    const ctx = makeContext({
      categoryEventMap: { Locations: "night-city-founded" },
    });
    const chunks = chunkArticles([article], ctx, TEST_CONFIG);

    for (const chunk of chunks) {
      expect(chunk.eventIds).toContain("night-city-founded");
    }
  });

  it("latestEventOrder is -1 when no events match (timeless)", () => {
    const article = makeArticle({
      title: "Glossary",
      slug: "glossary",
      sections: [{ heading: "", text: "This article is about terminology." }],
      categories: ["Meta"],
    });
    const ctx = makeContext();
    const chunks = chunkArticles([article], ctx, TEST_CONFIG);

    expect(chunks.length).toBe(1);
    expect(chunks[0].latestEventOrder).toBe(-1);
    expect(chunks[0].eventIds).toHaveLength(0);
  });

  it("article floor uses MIN of category anchors (earliest era)", () => {
    const article = makeArticle({
      categories: ["OldEra", "NewEra"],
    });
    const ctx = makeContext({
      categoryEventMap: {
        OldEra: "night-city-founded", // 199401
        NewEra: "v-arrives", // 207701
      },
    });
    const chunks = chunkArticles([article], ctx, TEST_CONFIG);

    // Earliest era (199401) is when the subject becomes knowable
    for (const chunk of chunks) {
      expect(chunk.latestEventOrder).toBe(199401);
      expect(chunk.eventIds).toContain("night-city-founded");
      expect(chunk.eventIds).toContain("v-arrives");
    }
  });

  it("splits long text with sentence boundaries into multiple chunks", () => {
    // targetChars=1400, maxChars=2048 for TEST_CONFIG; create text >2048 with sentence boundaries
    const sentence = "This is a sentence about Night City and its sprawling districts. ";
    const longText = sentence.repeat(40); // ~64*40 = 2560 chars

    const article = makeArticle({
      sections: [{ heading: "", text: longText }],
    });
    const ctx = makeContext();
    const chunks = chunkArticles([article], ctx, TEST_CONFIG);

    // Text is too long to fit in one chunk — should be split
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    // Non-final chunks should end at a sentence boundary (period after trim)
    for (const chunk of chunks.slice(0, -1)) {
      expect(chunk.text).toMatch(/[.!?]$/);
    }
  });

  it("force-splits long text with no sentence boundaries", () => {
    // No periods/exclamation/question marks — hits the force-split branch (chunk.ts:72-73)
    const word = "nightcity ";
    const longText = word.repeat(300); // ~10*300 = 3000 chars, no sentence terminators

    const article = makeArticle({
      sections: [{ heading: "", text: longText }],
    });
    const ctx = makeContext();
    const chunks = chunkArticles([article], ctx, TEST_CONFIG);

    // Force split at targetChars means at least 2 chunks
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });

  it("titleEventOverrides raises the latestEventOrder floor for matching article", () => {
    const article = makeArticle(); // title: "Night City"
    const ctx = makeContext({
      titleEventOverrides: {
        "Night City": ["v-arrives"], // order 207701
      },
    });
    const chunks = chunkArticles([article], ctx, TEST_CONFIG);

    for (const chunk of chunks) {
      expect(chunk.eventIds).toContain("v-arrives");
      // overrideFloor (207701) dominates articleFloor (-1) and sectionFloor (-1)
      expect(chunk.latestEventOrder).toBe(207701);
    }
  });

  it("section-heading year raises the floor above the article floor", () => {
    const article = makeArticle({
      sections: [
        { heading: "", text: "Intro body." },
        { heading: "2076", text: "Events from 2076." },
        { heading: "2020 - 2023", text: "Events spanning 2020 to 2023." },
        { heading: "Early life - 2010s", text: "Decade heading maps to 2010." },
      ],
      categories: ["OldEra"],
    });
    const ctx = makeContext({
      categoryEventMap: { OldEra: "night-city-founded" }, // 199401
    });
    const chunks = chunkArticles([article], ctx, TEST_CONFIG);

    // Intro: no section year -> article floor applies
    expect(chunks[0].latestEventOrder).toBe(199401);
    // "2076" -> 207601
    expect(chunks[1].latestEventOrder).toBe(207601);
    // "2020 - 2023" -> latest year 2023 -> 202301
    expect(chunks[2].latestEventOrder).toBe(202301);
    // "Early life - 2010s" -> decade-start 2010 -> 201001
    expect(chunks[3].latestEventOrder).toBe(201001);
  });

  it("decade heading with 's' suffix alone (e.g. '2010s') maps to 201001", () => {
    const article = makeArticle({
      sections: [{ heading: "2010s", text: "Events during the 2010s." }],
      categories: [],
    });
    const ctx = makeContext();
    const chunks = chunkArticles([article], ctx, TEST_CONFIG);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].latestEventOrder).toBe(201001);
  });

  it("recognizes '!' and '?' as sentence terminators when splitting", () => {
    // targetChars = 40, maxChars = 64, overlapChars = 4 -> force splits long text
    // We want to verify '!' and '?' are treated as boundaries. Use text whose
    // length > maxChars so a split is required, containing only '!' and '?'.
    const seg1 = "This is an exciting statement about Night City! "; // ends with '!'
    const seg2 = "Why did the Corporate War happen in 2023? "; // ends with '?'
    const text = (seg1 + seg2).repeat(6); // > 64 chars

    const chunks = splitIntoChunks(text, 10, 16, 1);
    // At least 2 chunks because text > maxChars=64
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    // Non-final chunks must end at a sentence terminator after trim
    for (const ch of chunks.slice(0, -1)) {
      expect(ch).toMatch(/[.!?]$/);
    }
  });

  it("overlap: next chunk start equals boundary - overlapChars", () => {
    // Build two sentences so there's exactly one candidate boundary around targetChars.
    // targetTokens=10 -> targetChars=40, maxTokens=12 -> maxChars=48, overlapTokens=2 -> overlapChars=8
    const a = "A sentence ends here sharp and brief. "; // 38 chars; '.' at idx 36, boundary idx = 37
    const b = "Another sentence follows here now ok! "; // 38 chars
    const text = a + b + "More tail text that should not matter here.";

    const chunks = splitIntoChunks(text, 10, 12, 2);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    // The first chunk ends at the '. ' boundary in sentence A (trimmed = a.trim())
    expect(chunks[0]).toBe(a.trim());
    // Boundary index (the position AFTER the '.') in text: "." is at index 36, so boundary = 37.
    const boundary = 37;
    const overlapChars = 2 * 4;
    const nextStart = boundary - overlapChars; // 29
    // chunks[1] should be text.slice(nextStart, <next boundary>).trim().
    // The next boundary is the same '.' at 36 (next=37), since 36 < start+40=69 and no later
    // punct exists before 69. So chunks[1] = text.slice(29, 37).trim() = "d brief."
    expect(chunks[1]).toBe(text.slice(nextStart, boundary).trim());
  });

  it("force-splits mid-text when no sentence boundary exists within maxChars", () => {
    // No punctuation at all — must hit the forced-split branch (boundary = start + targetChars)
    const text = "word".repeat(200); // 800 chars, no '.', '!' or '?'
    const chunks = splitIntoChunks(text, 10, 16, 2);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    // Each non-final chunk should be roughly targetChars long (40) since no boundary exists
    for (const ch of chunks.slice(0, -1)) {
      // With forced splits it should be close to 40 chars
      expect(ch.length).toBeLessThanOrEqual(40);
    }
  });

  it("returns [] for empty input", () => {
    expect(splitIntoChunks("", 10, 16, 2)).toEqual([]);
    expect(splitIntoChunks("   \n\t  ", 10, 16, 2)).toEqual([]);
  });

  it("returns a single chunk when text fits exactly in maxChars", () => {
    // maxTokens=10 -> maxChars=40. Text length <= 40 fits in one chunk.
    const text = "Exactly within max bounds of this chunk."; // 40 chars
    expect(text.length).toBe(40);
    const chunks = splitIntoChunks(text, 8, 10, 2);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe(text);
  });
});
