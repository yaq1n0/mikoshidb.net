import { describe, expect, it } from "vitest";
import { engrams, findEngram } from "@/engrams";

describe("engrams catalog", () => {
  it("has four known ids with populated fields", () => {
    const ids = engrams.map((e) => e.id).sort();
    expect(ids).toEqual(["alt-cunningham", "johnny-silverhand", "saburo-arasaka", "v"].sort());
    for (const e of engrams) {
      expect(e.displayName.length).toBeGreaterThan(0);
      expect(e.handle.length).toBeGreaterThan(0);
      expect(e.bio.length).toBeGreaterThan(0);
      expect(e.systemPrompt.length).toBeGreaterThan(0);
      expect(e.cutoffEventId.length).toBeGreaterThan(0);
    }
  });

  it("findEngram returns a matching record or undefined", () => {
    expect(findEngram("johnny-silverhand")?.id).toBe("johnny-silverhand");
    expect(findEngram("??")).toBeUndefined();
  });
});
