import { describe, it, expect } from "vitest";
import { assembleLorePreamble } from "./prompt.ts";
import type { RetrievedChunk, Chunk } from "../types.ts";

function makeChunk(header: string, text: string): Chunk {
  return {
    id: "test#0",
    articleId: "test",
    title: "Test",
    header,
    text,
    eventIds: [],
    latestEventOrder: -1,
    tags: [],
    categories: [],
  };
}

function makeRetrieved(header: string, text: string): RetrievedChunk {
  return { chunk: makeChunk(header, text), score: 0.5, source: "dense" };
}

const META = { source: "cyberpunk fandom wiki", license: "CC-BY-SA" };

describe("assembleLorePreamble()", () => {
  it("returns empty string for no chunks", () => {
    expect(assembleLorePreamble([], META)).toBe("");
  });

  it("formats chunks with <lore> tags and instruction text", () => {
    const result = assembleLorePreamble([makeRetrieved("[Arasaka]", "A megacorporation.")], META);
    expect(result).toContain('<lore source="cyberpunk fandom wiki, CC-BY-SA">');
    expect(result).toContain("</lore>");
    expect(result).toContain("The above lore is what your memory contains");
    expect(result).toContain("never quote it verbatim");
  });

  it("each chunk shows header + text", () => {
    const result = assembleLorePreamble(
      [
        makeRetrieved("[Adam Smasher]", "Full-borg solo."),
        makeRetrieved("[Johnny > Bio]", "Rockerboy."),
      ],
      META,
    );
    expect(result).toContain("[Adam Smasher] Full-borg solo.");
    expect(result).toContain("[Johnny > Bio] Rockerboy.");
  });

  it("uses source and license from meta", () => {
    const result = assembleLorePreamble([makeRetrieved("[X]", "y")], {
      source: "example.wiki",
      license: "MIT",
    });
    expect(result).toContain('<lore source="example.wiki, MIT">');
  });
});
