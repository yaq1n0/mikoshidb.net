import { describe, it, expect } from "vitest";
import { unitNormalize } from "./vector-math.ts";

function l2(vec: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < vec.length; i++) sum += vec[i] * vec[i];
  return Math.sqrt(sum);
}

describe("unitNormalize()", () => {
  it("leaves a zero vector unchanged (no NaN, norm stays 0)", () => {
    const vec = new Float32Array([0, 0, 0, 0]);
    unitNormalize(vec);
    for (const v of vec) {
      expect(v).toBe(0);
      expect(Number.isNaN(v)).toBe(false);
    }
    expect(l2(vec)).toBe(0);
  });

  it("leaves an already-unit vector unit after the call", () => {
    // A unit vector along the first axis
    const vec = new Float32Array([1, 0, 0, 0]);
    unitNormalize(vec);
    expect(Math.abs(l2(vec) - 1)).toBeLessThan(1e-6);
    expect(vec[0]).toBeCloseTo(1, 6);
  });

  it("normalizes an arbitrary vector to unit L2 norm", () => {
    const vec = new Float32Array([3, 4, 0, 0]); // norm=5
    unitNormalize(vec);
    expect(Math.abs(l2(vec) - 1)).toBeLessThan(1e-6);
    // 3/5 = 0.6, 4/5 = 0.8
    expect(vec[0]).toBeCloseTo(0.6, 6);
    expect(vec[1]).toBeCloseTo(0.8, 6);
  });

  it("normalizes a larger arbitrary vector to unit L2 norm", () => {
    const vec = new Float32Array([1.5, -2.25, 0.5, -3.0, 7.1, 0.01]);
    unitNormalize(vec);
    expect(Math.abs(l2(vec) - 1)).toBeLessThan(1e-6);
  });
});
