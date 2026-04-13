import type { ChatCompletionMessageParam, MLCEngineInterface } from "@mlc-ai/web-llm";

export type StreamChunk = {
  delta: string;
  done: boolean;
};

/**
 * Stream a completion from the loaded engine. Yields chunks as they arrive so
 * the terminal can append tokens to the active scrollback line in real time.
 *
 * Sampling is tuned for character roleplay, not for assistant Q&A:
 * - temperature 0.9 — commits to a voice instead of regressing to safe phrasing
 * - top_p 0.9 — trims the long tail without choking creativity
 * - frequency_penalty 0.4 — discourages "I'm sorry, I'm not sure..." filler that
 *   the base instruct models reach for when they don't know an answer
 * - presence_penalty 0.3 — pushes the model to introduce new in-character
 *   content rather than rewording the user's prompt back at them
 *
 * Note: WebLLM rejects trailing assistant messages
 * (see openai_api_protocols postInitAndCheckGenerationConfigValues), so we
 * cannot prefill the assistant turn via the messages array. The same effect is
 * achieved in the engram system prompts via few-shot exchanges that anchor the
 * response shape (handle prefix + voice).
 */
export async function* streamReply(
  engine: MLCEngineInterface,
  systemPrompt: string,
  history: Array<{ role: "user" | "assistant"; content: string }>,
  userMessage: string,
  lorePreamble?: string,
): AsyncGenerator<StreamChunk, void, void> {
  // Lore goes BEFORE the system prompt (system prompt last = strongest voice).
  const systemContent = lorePreamble ? `${lorePreamble}\n\n${systemPrompt}` : systemPrompt;

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemContent },
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: userMessage },
  ];

  const stream = await engine.chat.completions.create({
    messages,
    stream: true,
    temperature: 0.9,
    top_p: 0.9,
    frequency_penalty: 0.4,
    presence_penalty: 0.3,
    max_tokens: 384,
  });

  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta?.content ?? "";
    if (delta) yield { delta, done: false };
  }
  yield { delta: "", done: true };
}
