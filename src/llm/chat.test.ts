import { describe, expect, it, vi } from "vitest";
import type { MLCEngineInterface } from "@mlc-ai/web-llm";
import { streamReply } from "@/llm/chat";

type CreateArgs = {
  messages: Array<{ role: string; content: string }>;
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  max_tokens?: number;
};

/** Build a minimal engine stub whose `create` returns a fixed async-iterable. */
const makeEngine = (deltas: string[]) => {
  const create = vi.fn(async (_args: CreateArgs) => {
    async function* stream() {
      for (const content of deltas) {
        yield { choices: [{ delta: { content } }] };
      }
      // Final empty delta — exercises the `if (delta)` filter in streamReply.
      yield { choices: [{ delta: { content: "" } }] };
    }
    return stream();
  });
  const engine = {
    chat: { completions: { create } },
  } as unknown as MLCEngineInterface;
  return { engine, create };
};

/** Collect all chunks from the async generator. */
const collect = async (
  gen: AsyncGenerator<{ delta: string; done: boolean }, void, void>,
): Promise<Array<{ delta: string; done: boolean }>> => {
  const out: Array<{ delta: string; done: boolean }> = [];
  for await (const c of gen) out.push(c);
  return out;
};

describe("streamReply", () => {
  it("yields deltas in order followed by a final done:true", async () => {
    const { engine } = makeEngine(["he", "llo"]);
    const chunks = await collect(streamReply(engine, "sys", [], "hi"));
    expect(chunks).toEqual([
      { delta: "he", done: false },
      { delta: "llo", done: false },
      { delta: "", done: true },
    ]);
  });

  it("prepends the lore preamble to the system message when provided", async () => {
    const { engine, create } = makeEngine([]);
    await collect(streamReply(engine, "SYS", [], "hi", "LORE"));
    const args = create.mock.calls[0]![0];
    expect(args.messages[0]).toEqual({
      role: "system",
      content: "LORE\n\nSYS",
    });
  });

  it("uses the system prompt alone when no preamble is provided", async () => {
    const { engine, create } = makeEngine([]);
    await collect(streamReply(engine, "SYS", [], "hi"));
    const args = create.mock.calls[0]![0];
    expect(args.messages[0]).toEqual({ role: "system", content: "SYS" });
  });

  it("forwards history and appends the new user message last", async () => {
    const { engine, create } = makeEngine([]);
    const history = [
      { role: "user" as const, content: "q1" },
      { role: "assistant" as const, content: "a1" },
    ];
    await collect(streamReply(engine, "SYS", history, "q2"));
    const args = create.mock.calls[0]![0];
    expect(args.messages).toEqual([
      { role: "system", content: "SYS" },
      { role: "user", content: "q1" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "q2" },
    ]);
  });

  it("forwards the sampling kwargs", async () => {
    const { engine, create } = makeEngine([]);
    await collect(streamReply(engine, "SYS", [], "hi"));
    const args = create.mock.calls[0]![0];
    expect(args.stream).toBe(true);
    expect(args.temperature).toBe(0.9);
    expect(args.top_p).toBe(0.9);
    expect(args.frequency_penalty).toBe(0.4);
    expect(args.presence_penalty).toBe(0.3);
    expect(args.max_tokens).toBe(384);
  });
});
