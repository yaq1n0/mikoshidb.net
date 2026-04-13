# UI Architecture

How the mikoshidb.net terminal is wired: state, theming, commands, chat streaming, and debugging.

For RAG specifics, see [RAG_QUERY.md](RAG_QUERY.md) and [RAG_BUILD.md](RAG_BUILD.md).

## Stack

- **Vue 3** with the Composition API and `<script setup>` SFCs
- **TypeScript** end-to-end
- **Tailwind CSS v4** (configured via `@tailwindcss/vite`, consumes CSS variables)
- **WebLLM** (`@mlc-ai/web-llm`) for in-browser LLM inference over WebGPU
- **opensona/runtime** for RAG retrieval

## State management

No store library. State lives in module-scoped Vue reactives inside [src/terminal/session.ts](../src/terminal/session.ts):

- `session` (`reactive`) — scrollback lines, `mode` (`"shell" | "chat" | "loading"`), theme id, current engram, current firmware, chat history.
- `engineRef` (`shallowRef`) — the WebLLM `MLCEngineInterface` instance. Non-reactive wrapper so Vue does not proxy the engine's internals.
- `ragRef` (`shallowRef`) — the `OpensonaRuntime` instance, same rationale.
- `focusInput` (`ref`) — signal flag the terminal component watches to refocus the input.

Helper functions (`print`, `pushProgress`, `beginChatReply`, …) mutate the scrollback so components stay thin.

Per-turn RAG diagnostics are kept in a separate module, [src/terminal/ragLog.ts](../src/terminal/ragLog.ts), capped at 200 entries and persisted to `localStorage`.

### localStorage keys

| Key                   | Written by                                          | Purpose                              |
| --------------------- | --------------------------------------------------- | ------------------------------------ |
| `mikoshi.theme`       | [src/themes/index.ts](../src/themes/index.ts)       | Last selected theme id               |
| `mikoshi.rag.log`     | [src/terminal/ragLog.ts](../src/terminal/ragLog.ts) | Rolling RAG query diagnostics (≤200) |
| `mikoshi.debug.width` | [src/App.vue](../src/App.vue)                       | Debug sidebar width (px)             |

## Theming

Themes are pure CSS — no JS colour logic. Four themes are defined in [src/styles/themes.css](../src/styles/themes.css): `arasaka`, `nightcity`, `netrunner`, `militech`. Each sets the same set of CSS variables (`--bg`, `--fg`, `--dim`, `--accent`, `--warn`, `--danger`, `--glow`, …).

Tailwind utility classes are wired to those variables in [src/styles/base.css](../src/styles/base.css) via `@theme`, so `bg-bg`, `text-accent`, etc. follow the active theme. The cyberpunk chrome (CRT scanlines, vignette, JetBrains Mono, glitch keyframes) also lives in `base.css`.

Switching themes calls `applyTheme(id)` from [src/themes/index.ts](../src/themes/index.ts), which sets `document.documentElement.dataset.theme` and persists the choice. `loadSavedTheme()` restores it at boot.

## Boot sequence

[src/components/BootSequence.vue](../src/components/BootSequence.vue) prints an ASCII BIOS-style POST, then probes `navigator.gpu`. If WebGPU is missing the app falls through to [src/components/LockoutScreen.vue](../src/components/LockoutScreen.vue); otherwise it emits `done` and the terminal takes over.

## Terminal & commands

The UI is line-oriented, not a command palette. Input flows through:

1. [src/components/Terminal.vue](../src/components/Terminal.vue) renders scrollback and captures keypresses.
2. [src/terminal/parser.ts](../src/terminal/parser.ts) splits on whitespace into `{ name, args }`.
3. [src/terminal/commands.ts](../src/terminal/commands.ts) dispatches to the right handler based on `session.mode`.

Scrollback lines carry a `kind` (`out`, `cmd`, `info`, `warn`, `error`, `banner`, `progress`, `chat-user`, `chat-reply`) which the Terminal component maps to styles.

### Available commands (shell mode)

`help`, `ls`, `load <firmware>`, `jack-in <engram>`, `disconnect`, `status`, `clear`, `whoami`, `theme [name]`, plus a few cosmetics. See [commands.ts](../src/terminal/commands.ts) for the source of truth.

In **chat mode** any non-command input is routed to `sendChat()` — the terminal behaves like a messaging client until the user runs `disconnect`.

## Chat streaming

Implemented in [src/llm/chat.ts](../src/llm/chat.ts) as an `AsyncGenerator`. It is **not** SSE — it consumes WebLLM's async iterator directly:

```ts
const stream = await engine.chat.completions.create({ messages, stream: true, ... });
for await (const chunk of stream) { yield chunk.choices[0].delta.content; }
```

Tokens are appended to the active reply line; Vue reactivity re-renders on each tick.

Sampling is tuned for character roleplay (see the comment block in [chat.ts](../src/llm/chat.ts)):

| Param               | Value |
| ------------------- | ----- |
| `temperature`       | 0.9   |
| `top_p`             | 0.9   |
| `frequency_penalty` | 0.4   |
| `presence_penalty`  | 0.3   |
| `max_tokens`        | 384   |

### Prompt assembly (lore preamble)

`streamReply(engine, systemPrompt, history, userMessage, lorePreamble?)` concatenates the lore block **before** the engram system prompt into a **single** `system` message:

```
system: <lore …>…</lore>\n\n<engramSystemPrompt>
history...
user: <userMessage>
```

Lore comes first so the engram's system prompt is the last (and therefore strongest) voice signal the model sees. WebLLM also rejects a trailing assistant message, so we do not prefill the reply — the voice is anchored by few-shot exchanges baked into the engram system prompts instead.

See [RAG_QUERY.md](RAG_QUERY.md) for how the preamble is retrieved.

## Firmwares & engrams

- **Firmwares** ([src/firmware/](../src/firmware/)) — three WebLLM-prebuilt models. WebLLM downloads weights into IndexedDB on first load; the loader reports progress as a bar + phase text (see the `progress` scrollback kind).
- **Engrams** ([src/engrams/](../src/engrams/)) — four character personas. Each carries a long in-character system prompt plus a `cutoffEventId` and optional `excludeTags` consumed by RAG. System prompts embed dossiers and relationship maps so voice survives without RAG hits.

## Debug sidebar

Append `?debug=true` to the URL to reveal [src/components/DebugSidebar.vue](../src/components/DebugSidebar.vue). It renders `ragLog` with:

- query text, engram, applied `cutoffEventId`
- retrieved chunks (id, score, `source` of `dense | bm25 | both`)
- filtered-out count
- copy-as-JSON and download buttons
- clear-log action

The sidebar is draggable; its width persists to `mikoshi.debug.width`.
