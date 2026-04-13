import { describe, expect, it } from "vitest";
import { budgetChunks } from "@/terminal/budget";

type TestChunk = { chunk: { header: string; text: string }; id: string };

/** Build a chunk with header+text totaling `cost - 1` characters. */
const chunkOf = (id: string, cost: number): TestChunk => ({
  id,
  chunk: { header: "", text: "x".repeat(cost - 1) },
});

describe("budgetChunks", () => {
  it("returns an empty array for empty input", () => {
    expect(budgetChunks([], 100)).toEqual([]);
  });

  it("always keeps the first chunk even if it exceeds the budget", () => {
    const [a] = [chunkOf("a", 500)];
    const result = budgetChunks([a!], 100);
    expect(result).toEqual([a]);
  });

  it("returns both chunks when they both fit", () => {
    const a = chunkOf("a", 40);
    const b = chunkOf("b", 40);
    expect(budgetChunks([a, b], 100)).toEqual([a, b]);
  });

  it("stops before a chunk that would overflow the budget", () => {
    const a = chunkOf("a", 40);
    const b = chunkOf("b", 40);
    const c = chunkOf("c", 40);
    // a+b = 80; adding c would hit 120 > 100 → stop at two
    expect(budgetChunks([a, b, c], 100)).toEqual([a, b]);
  });

  it("preserves input order", () => {
    const a = chunkOf("a", 10);
    const b = chunkOf("b", 10);
    const c = chunkOf("c", 10);
    const result = budgetChunks([a, b, c], 1000);
    expect(result.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });
});
