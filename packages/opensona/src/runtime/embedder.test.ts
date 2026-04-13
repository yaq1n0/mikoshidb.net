import { describe, it, expect, vi, beforeEach } from "vitest";

// The transformers package is dynamically imported inside embedder.ts. We
// replace it with a controllable mock so tests never hit real model weights.
vi.mock("@huggingface/transformers", () => ({
  pipeline: vi.fn(),
}));

async function freshEmbedder(): Promise<typeof import("./embedder.ts")> {
  vi.resetModules();
  return await import("./embedder.ts");
}

/** Build a pipeline fn that echoes a fixed vector regardless of input. */
function makePipelineReturning(vec: Float32Array) {
  return vi.fn(async () => ({ data: vec, dims: [1, vec.length] }));
}

describe("embedQuery()", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
  });

  it("first embedQuery dynamically imports transformers and calls pipeline once", async () => {
    const { pipeline } = await import("@huggingface/transformers");
    const pipeFn = makePipelineReturning(new Float32Array([3, 4]));
    vi.mocked(pipeline).mockResolvedValue(pipeFn as never);

    const { embedQuery } = await freshEmbedder();

    const out = await embedQuery("hello", "model-a");
    expect(out).toBeInstanceOf(Float32Array);
    expect(vi.mocked(pipeline)).toHaveBeenCalledTimes(1);
  });

  it("same modelId reuses the cached pipeline (no second pipeline() call)", async () => {
    const { pipeline } = await import("@huggingface/transformers");
    const pipeFn = makePipelineReturning(new Float32Array([1, 0]));
    vi.mocked(pipeline).mockResolvedValue(pipeFn as never);

    const { embedQuery } = await freshEmbedder();
    await embedQuery("q1", "model-a");
    await embedQuery("q2", "model-a");

    expect(vi.mocked(pipeline)).toHaveBeenCalledTimes(1);
    expect(pipeFn).toHaveBeenCalledTimes(2);
  });

  it("different modelId triggers a new pipeline instance", async () => {
    const { pipeline } = await import("@huggingface/transformers");
    const pipeFnA = makePipelineReturning(new Float32Array([1, 0]));
    const pipeFnB = makePipelineReturning(new Float32Array([0, 1]));
    vi.mocked(pipeline)
      .mockResolvedValueOnce(pipeFnA as never)
      .mockResolvedValueOnce(pipeFnB as never);

    const { embedQuery } = await freshEmbedder();
    await embedQuery("q", "model-a");
    await embedQuery("q", "model-b");

    expect(vi.mocked(pipeline)).toHaveBeenCalledTimes(2);
  });

  it("L2-normalizes the output vector (norm ~= 1.0)", async () => {
    const { pipeline } = await import("@huggingface/transformers");
    // [3, 4] → norm 5 → normalized [0.6, 0.8]
    const pipeFn = makePipelineReturning(new Float32Array([3, 4]));
    vi.mocked(pipeline).mockResolvedValue(pipeFn as never);

    const { embedQuery } = await freshEmbedder();
    const out = await embedQuery("q", "model-norm");

    let norm = 0;
    for (let i = 0; i < out.length; i++) norm += out[i] * out[i];
    norm = Math.sqrt(norm);
    expect(norm).toBeCloseTo(1.0, 6);
    expect(out[0]).toBeCloseTo(0.6, 6);
    expect(out[1]).toBeCloseTo(0.8, 6);
  });

  it("zero-vector input returns zero-vector output with no NaN", async () => {
    const { pipeline } = await import("@huggingface/transformers");
    const pipeFn = makePipelineReturning(new Float32Array([0, 0, 0, 0]));
    vi.mocked(pipeline).mockResolvedValue(pipeFn as never);

    const { embedQuery } = await freshEmbedder();
    const out = await embedQuery("q", "model-zero");

    expect(out.length).toBe(4);
    for (const v of out) {
      expect(v).toBe(0);
      expect(Number.isNaN(v)).toBe(false);
    }
  });

  it("converts non-Float32Array pipeline data into a Float32Array before normalizing", async () => {
    const { pipeline } = await import("@huggingface/transformers");
    // Simulate a pipeline that returns a plain number[] rather than Float32Array.
    const pipeFn = vi.fn(async () => ({ data: [3, 4] as unknown as Float32Array, dims: [1, 2] }));
    vi.mocked(pipeline).mockResolvedValue(pipeFn as never);

    const { embedQuery } = await freshEmbedder();
    const out = await embedQuery("q", "model-convert");

    expect(out).toBeInstanceOf(Float32Array);
    expect(out[0]).toBeCloseTo(0.6, 6);
    expect(out[1]).toBeCloseTo(0.8, 6);
  });
});
