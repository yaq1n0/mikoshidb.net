import { describe, it, expect } from "vitest";
import type { Chunk, RetrievedChunk } from "../types.ts";
import { assembleLorePreamble } from "./prompt.ts";

const mkChunk = (over: Partial<Chunk>): Chunk => ({
  id: "x",
  articleId: "x",
  title: "X",
  header: "[X]",
  text: "x-text",
  eventIds: [],
  latestEventOrder: -1,
  tags: [],
  categories: [],
  ...over,
});

const mkRetrieved = (over: Partial<Chunk>): RetrievedChunk => ({
  chunk: mkChunk(over),
  source: "lead",
  hops: 0,
});

describe("assembleLorePreamble()", () => {
  it("returns empty string when no chunks are provided", () => {
    const out = assembleLorePreamble([], { source: "https://s", license: "L" });
    expect(out).toBe("");
  });

  it("wraps a <lore> block with header + text joined by newlines and trailing instruction", () => {
    const chunks = [
      mkRetrieved({ header: "[Alpha]", text: "first" }),
      mkRetrieved({ header: "[Bravo]", text: "second" }),
    ];
    const out = assembleLorePreamble(chunks, {
      source: "https://example.fandom.com",
      license: "CC-BY-SA",
    });
    expect(out.startsWith('<lore source="https://example.fandom.com, CC-BY-SA">')).toBe(true);
    expect(out).toContain("[Alpha] first\n[Bravo] second");
    expect(out).toContain("</lore>");
    expect(out).toContain("reference material");
  });

  it("interpolates meta.source and meta.license into the opening tag", () => {
    const chunks = [mkRetrieved({})];
    const out = assembleLorePreamble(chunks, { source: "SRC", license: "LIC" });
    expect(out).toContain('<lore source="SRC, LIC">');
  });
});
