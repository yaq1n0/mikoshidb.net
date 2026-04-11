# Vitest Testing Plan

This plan covers the **Vitest** layer only. The goal here is to lock down everything that can be tested without WebGPU and without downloading WebLLM models, which is roughly 80% of the surface area.

The plan is written so another Claude Code instance can implement it end to end without needing to re-derive the architecture. Read this whole file before starting.

---

## 1. Setup

### 1.1 Dependencies

Add as devDependencies (use `pnpm add -D`):

- `vitest`
- `@vitest/coverage-v8`
- `@testing-library/vue` // use this so that we use better assertions (user-facing)
- `@vue/test-utils`
- `jsdom`
- `happy-dom` _(optional alternative; pick one — jsdom is the safer default because it has a real `localStorage`)_

### 1.2 Vitest config

Add a `vitest` block to [vite.config.ts](vite.config.ts) so the existing `@/` alias and Vue plugin are reused. Do **not** create a separate `vitest.config.ts` — it duplicates config and the two will drift.

```ts
// inside defineConfig({...})
test: {
  environment: "jsdom",
  globals: false,            // prefer explicit imports from "vitest"
  setupFiles: ["./tests/setup.ts"],
  include: ["tests/**/*.test.ts"],
  coverage: {
    provider: "v8",
    reporter: ["text", "html"],
    include: ["src/**/*.{ts,vue}"],
    exclude: ["src/main.ts", "src/shims-vue.d.ts", "src/**/*.d.ts"],
  },
},
```

You will need a triple-slash reference at the top of `vite.config.ts`:

```ts
/// <reference types="vitest" />
```

### 1.3 package.json scripts

Add:

```json
"test": "vitest run",
"test:watch": "vitest",
"test:coverage": "vitest run --coverage"
```

### 1.4 Test directory layout

```
tests/
  setup.ts
  helpers/
    session.ts        # resetSession() — see §2.1
    fakeEngine.ts     # makeFakeEngine() — see §2.2
  unit/
    parser.test.ts
    firmware-registry.test.ts
    engrams-registry.test.ts
    themes.test.ts
    webgpu.test.ts
    chat-stream.test.ts
    session.test.ts
    commands/
      help.test.ts
      clear.test.ts
      whoami.test.ts
      status.test.ts
      ls.test.ts
      info.test.ts
      load.test.ts
      jack-in.test.ts
      disconnect.test.ts
      theme.test.ts
      reboot.test.ts
      unknown.test.ts
      send-chat.test.ts
  components/
    BootSequence.test.ts
    LockoutScreen.test.ts
    Terminal.test.ts
```

One file per command keeps blast radius small and lets failures point at the exact command. If that feels excessive partway through, collapse only the trivial ones (`whoami`, `clear`, `reboot`, `unknown`) into a single `commands/misc.test.ts`.

### 1.5 tests/setup.ts

```ts
import { beforeEach, vi } from "vitest";
import { resetSession } from "./helpers/session";

beforeEach(() => {
  resetSession();
  // jsdom has localStorage but tests should not leak theme state across files
  localStorage.clear();
  // reset documentElement.dataset.theme that applyTheme() writes
  document.documentElement.removeAttribute("data-theme");
  vi.restoreAllMocks();
});
```

---

## 2. Critical helpers (read before writing any tests)

### 2.1 The session is a module-level singleton — you must reset it

[src/terminal/session.ts:46](src/terminal/session.ts#L46) creates a `reactive()` `session` object at module load. There is **no `resetSession()` exported**. Tests will pollute each other unless you reset it manually in `beforeEach`.

Create `tests/helpers/session.ts`:

```ts
import { session, engineRef, clearScrollback } from "@/terminal/session";

export function resetSession(): void {
  clearScrollback();
  session.mode = "shell";
  session.theme = "arasaka";
  session.currentEngram = null;
  session.currentFirmware = null;
  session.chatHistory = [];
  engineRef.value = null;
}
```

Do **not** try to reassign `session = ...` — it is `const` and reactive. Mutate fields in place.

Note: `lineSeq` in [session.ts:43](src/terminal/session.ts#L43) is a module-private counter that monotonically increases across the whole test run. That is fine — assertions should never compare against absolute `id` values; only check ordering or that an `id` exists.

### 2.2 Fake MLCEngine

`engineRef.value` is typed `MLCEngineInterface | null`. Many command tests need a non-null engine but never call into it. Create `tests/helpers/fakeEngine.ts`:

```ts
import type { MLCEngineInterface } from "@mlc-ai/web-llm";

export interface FakeEngineOptions {
  /** Tokens the fake stream will yield, in order. Default: ["hello", " ", "world"] */
  tokens?: string[];
  /** If set, the stream rejects with this error instead of yielding. */
  error?: Error;
}

export function makeFakeEngine(opts: FakeEngineOptions = {}): MLCEngineInterface {
  const tokens = opts.tokens ?? ["hello", " ", "world"];
  return {
    chat: {
      completions: {
        create: vi.fn(async () => {
          if (opts.error) throw opts.error;
          return {
            async *[Symbol.asyncIterator]() {
              for (const t of tokens) {
                yield { choices: [{ delta: { content: t } }] };
              }
            },
          };
        }),
      },
    },
  } as unknown as MLCEngineInterface;
}
```

The cast to `unknown as MLCEngineInterface` is required because we are not implementing the full interface — that is acceptable in tests.

Import `vi` from `vitest` at the top of the helper.

### 2.3 Capturing scrollback in assertions

`session.scrollback` is the source of truth for everything `print()` does. Test commands by running them and inspecting `session.scrollback`. Useful pattern:

```ts
const lines = session.scrollback.map((l) => ({ kind: l.kind, text: l.text }));
expect(lines).toContainEqual({ kind: "error", text: "usage: ls <engrams|firmware|themes>" });
```

Prefer asserting on individual lines (kind + text) over snapshot tests of the whole scrollback — snapshots will churn every time copy is tweaked.

---

## 3. Unit tests — pure modules

These touch nothing reactive and need no fakes.

### 3.1 `tests/unit/parser.test.ts` — [src/terminal/parser.ts](src/terminal/parser.ts)

Cases:

- Empty string → `null`
- Whitespace-only → `null`
- `"help"` → `{ command: "help", args: [], raw: "help" }`
- `"LS firmware"` → command is lowercased to `"ls"`, args preserved as `["firmware"]`
- `'info engram "johnny silverhand"'` → args = `["engram", "johnny silverhand"]` (quote handling)
- Multiple spaces between tokens collapse cleanly
- Unmatched quote: `'foo "bar'` → tokens still produced, `inQuote` left dangling. Document actual behavior, do not "fix" the parser. The test should pin current behavior so a future regression is caught.
- Leading/trailing whitespace stripped via `trim()` before tokenization (the `raw` field reflects the trimmed string)
- Unicode/emoji in args is preserved verbatim

### 3.2 `tests/unit/firmware-registry.test.ts` — [src/firmware/index.ts](src/firmware/index.ts)

Cases:

- `firmware` array is non-empty
- Every entry has unique `id`
- Every entry has unique `mlcModelId`
- `findFirmware("kiroshi-lite")` returns the lite entry
- `findFirmware("does-not-exist")` returns `undefined`
- All `approxSizeMB` values are positive numbers

The uniqueness checks are cheap insurance against copy-paste bugs when adding firmware.

### 3.3 `tests/unit/engrams-registry.test.ts` — [src/engrams/index.ts](src/engrams/index.ts)

Cases:

- `engrams` array is non-empty
- Every entry has unique `id`
- Every entry has a non-empty `systemPrompt` (this is the load-bearing field — an empty one would silently break chat)
- `findEngram("v")` returns the v engram
- `findEngram("nobody")` returns `undefined`

### 3.4 `tests/unit/themes.test.ts` — [src/themes/index.ts](src/themes/index.ts)

Cases:

- `themes` is non-empty, ids are unique
- `applyTheme("arasaka")` sets `document.documentElement.dataset.theme === "arasaka"` AND writes to `localStorage`
- `applyTheme("not-real")` is a no-op (no dataset change, no localStorage write). Note: assert by snapshotting `localStorage.length` before/after, since a fresh setup has it empty.
- `loadSavedTheme()` with no saved value returns `"arasaka"` and sets `dataset.theme` to `"arasaka"`
- `loadSavedTheme()` with a valid saved value returns it
- `loadSavedTheme()` with a stale/invalid saved value (e.g. `"oldtheme"`) falls back to `"arasaka"`
- The `try/catch` around `localStorage` is exercised by stubbing `Storage.prototype.setItem` to throw — it should not crash the call. Use `vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota") })`.

### 3.5 `tests/unit/webgpu.test.ts` — [src/llm/webgpu.ts](src/llm/webgpu.ts)

`navigator.gpu` does not exist in jsdom. Stub it in each test.

Cases:

- No `navigator.gpu` → returns `false`
- `navigator.gpu.requestAdapter()` resolves with an adapter object → `true`
- `requestAdapter()` resolves to `null` → `false`
- `requestAdapter()` rejects → `false` (catch branch)

Stub pattern:

```ts
Object.defineProperty(navigator, "gpu", {
  value: { requestAdapter: vi.fn().mockResolvedValue({}) },
  configurable: true,
});
```

Remember to delete the property in an `afterEach` or set `configurable: true` so the next test can redefine it.

---

## 4. Unit tests — session & chat stream

### 4.1 `tests/unit/session.test.ts` — [src/terminal/session.ts](src/terminal/session.ts)

Cases:

- `print("hi", "info")` appends a line and returns it; the returned object is the same reference that lives in `session.scrollback`
- `print` defaults `kind` to `"out"`
- `printLines(["a","b","c"], "banner")` appends 3 lines all of kind `"banner"`
- `pushProgress("starting")` returns a reactive object with `progress: 0`, `kind: "progress"`, and mutating `.text` / `.progress` on the returned object is visible on `session.scrollback[N]` (i.e. it is the same reactive proxy, not a copy). This is the load-bearing reactivity contract — verify it explicitly.
- `clearScrollback()` empties the array but does not reset other session fields
- `beginChatReply()` returns a reactive line with `streaming: true` and empty text; mutating `.text` is visible on the scrollback entry

### 4.2 `tests/unit/chat-stream.test.ts` — [src/llm/chat.ts](src/llm/chat.ts)

`streamReply` is an async generator. Use the fake engine from §2.2.

Cases:

- Yields a chunk per token, then a final `{ delta: "", done: true }`
- Empty token stream still yields a final `{ delta: "", done: true }` (test with `tokens: []`)
- The `messages` array passed to `engine.chat.completions.create` is `[system, ...history, user]` in that exact order — assert by inspecting `vi.fn` call args
- The sampling params (`temperature: 0.9`, `top_p: 0.9`, `frequency_penalty: 0.4`, `presence_penalty: 0.3`, `max_tokens: 384`, `stream: true`) are passed through verbatim. These are deliberate roleplay tunings per the doc comment — a regression here would silently degrade output quality.
- Chunks with no `delta.content` (e.g. role-only first chunk) are skipped — write a fake that yields `{ choices: [{ delta: {} }] }` first.

---

## 5. Command tests — [src/terminal/commands.ts](src/terminal/commands.ts)

Each test file follows the same shape:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { runCommand } from "@/terminal/commands";
import { session, engineRef } from "@/terminal/session";
import { makeFakeEngine } from "../../helpers/fakeEngine";
```

Run commands via the public `runCommand(name, args)` entry point — do **not** import the `commands` array and call `.run()` directly. Going through `runCommand` is what production does and exercises the dispatcher.

### 5.1 `commands/help.test.ts`

- `help` with no args prints `AVAILABLE COMMANDS` plus one row per registered command
- `help help` prints the usage and summary for `help`
- `help nonsense` prints the unknown-command error path

### 5.2 `commands/clear.test.ts`

- Pre-populate scrollback with some lines, run `clear`, assert `session.scrollback.length === 0`

### 5.3 `commands/whoami.test.ts`

- Outputs both expected lines, both with kind `"out"`

### 5.4 `commands/status.test.ts`

- With nothing loaded: shows `<none>` for firmware and engram, `offline` for engine, `shell` mode, `arasaka` theme
- With firmware loaded (set `session.currentFirmware` and `engineRef.value`): shows display name and `online`
- With an engram in chat mode: shows engram name

### 5.5 `commands/ls.test.ts`

- `ls` (no arg) → error `usage: ls <engrams|firmware|themes>`
- `ls engrams` → header line + one row per engram in `engrams`
- `ls firmware` → header line + one row per firmware
- `ls themes` → one row per theme
- `ls bogus` → error `ls: unknown target: bogus`

### 5.6 `commands/info.test.ts`

- `info` (no args) → usage error
- `info engram` (one arg) → usage error
- `info engram v` → prints display name, handle, era, BIO header, bio text
- `info engram nope` → `info: no such engram: nope`
- `info firmware kiroshi-lite` → prints manufacturer, model_id, approx size, description
- `info firmware nope` → `info: no such firmware: nope`
- `info weird id` → `info: unknown kind: weird`

### 5.7 `commands/load.test.ts` ⚠ requires mocking the loader

This is the trickiest command file. `load` calls `loadFirmware` from [src/firmware/loader.ts](src/firmware/loader.ts), which dynamically imports `@mlc-ai/web-llm`. Mock the loader module:

```ts
import { vi } from "vitest";
vi.mock("@/firmware/loader", () => ({
  loadFirmware: vi.fn(),
}));
import { loadFirmware } from "@/firmware/loader";
```

`vi.mock` is hoisted — the import below the mock call still resolves to the mocked module. This is the standard Vitest pattern; do not try to use `vi.doMock` here.

Cases:

- `load` (no args) → usage error
- `load firmware` (one arg) → usage error
- `load firmware nope` → `load: no such firmware: nope`
- Happy path: mock `loadFirmware` to invoke its `onProgress` callback a few times then resolve with a fake engine. Assert:
  - A progress line was pushed (kind `"progress"`)
  - The progress line's `.text` and `.progress` were updated as the callback fired (verify the in-place mutation)
  - On completion, `engineRef.value` is the fake engine, `session.currentFirmware` is set, the final progress line shows `100%` and `FLASH COMPLETE`
  - `session.mode` ends up back as `"shell"` (the `finally` block)
- Error path: mock `loadFirmware` to reject with `new Error("network down")`. Assert an error line `>> flash failed: network down` is printed and `session.mode` returns to `"shell"`.
- Reentrancy guard: set `session.mode = "loading"` manually before calling, assert the `load: another firmware is already flashing.` error and that `loadFirmware` was **not** called.

To assert the in-flight progress mutation, capture the progress line via `session.scrollback[N]` _before_ awaiting completion. One way: have the mock invoke the callback synchronously inside an `await Promise.resolve()` so the test can await between progress events. Simpler alternative: have the mock collect all progress events and fire them in a row, then assert the **final** state of the progress line (text contains `100%`, progress === 1). Pick the simpler one unless you specifically want to test mid-stream rendering.

### 5.8 `commands/jack-in.test.ts`

- `jack-in` (no args) → usage error
- `jack-in v` with no engine loaded → `jack-in: no firmware loaded.` plus the hint line. `session.mode` stays `"shell"`.
- `jack-in nope` with engine loaded → `jack-in: no such engram: nope`
- `jack-in v` happy path (with `engineRef.value` and `session.currentFirmware` pre-set):
  - `session.currentEngram` is the v engram
  - `session.chatHistory` is empty
  - `session.mode === "chat"`
  - The `NEURAL LINK ESTABLISHED` banner lines are printed with kind `"banner"`

### 5.9 `commands/disconnect.test.ts`

- `disconnect` while in shell mode → `disconnect: no active link.`
- `disconnect` while in chat mode (set up via direct mutation):
  - `session.mode === "shell"`
  - `session.currentEngram === null`
  - `session.chatHistory.length === 0`
  - The severed-link banner lines are printed

### 5.10 `commands/theme.test.ts`

- `theme` (no args) → lists themes
- `theme list` → lists themes
- `theme set` (no id) → usage error
- `theme set bogus` → `theme: unknown theme: bogus`
- `theme set netrunner` → `session.theme === "netrunner"`, `document.documentElement.dataset.theme === "netrunner"`, info line printed
- `theme garbage` → `usage: theme <list|set> [id]`

### 5.11 `commands/reboot.test.ts`

The comment in [commands.ts:317](src/terminal/commands.ts#L317) says this is normally intercepted by `Terminal.vue`. The dispatcher fallback just prints `>> rebooting cradle...`. Assert that one info line. Do **not** test the Terminal.vue interception here — that belongs in §6.3.

### 5.12 `commands/unknown.test.ts`

- `runCommand("not-a-command", [])` prints both `mikoshi: unknown command: not-a-command` (error) and the help hint (info).

### 5.13 `commands/send-chat.test.ts` — `sendChat()` from [commands.ts:336](src/terminal/commands.ts#L336)

`sendChat` is exported separately. It depends on `streamReply` from [src/llm/chat.ts](src/llm/chat.ts). Two ways to test:

**Option A (preferred):** mock `@/llm/chat` to return a controllable async generator. This isolates `sendChat` from `streamReply`'s real behavior.

```ts
vi.mock("@/llm/chat", () => ({
  streamReply: vi.fn(),
}));
```

**Option B:** use the real `streamReply` with a fake engine (§2.2). Slightly more integration-y, also fine. Pick one and stick with it; do not mix.

Cases:

- No engine and no engram → `chat: link is down. use 'disconnect'.`
- Happy path: set engine + engram + mode `"chat"`, call `sendChat("hello")`. Assert:
  - User input line printed with kind `"chat-user"`
  - A `chat-reply` line was created via `beginChatReply()` and accumulated the streamed tokens (final text equals concatenation of yielded deltas)
  - `replyLine.streaming === false` after the stream ends
  - `session.chatHistory` now has `[{role:"user", content:"hello"}, {role:"assistant", content:"<full reply>"}]`
- Error path: make `streamReply` (or the engine's `create`) throw mid-stream. Assert the reply line gets `[link error: <msg>]` appended and `streaming === false`. The chat history should NOT have either entry pushed (the `push` calls live after the loop and never run).

---

## 6. Component tests

These are lower priority than §3–§5. Implement them only after the unit + command tests are green. Use `@vue/test-utils` `mount`.

### 6.1 `components/LockoutScreen.test.ts` — [src/components/LockoutScreen.vue](src/components/LockoutScreen.vue)

Read the component first, then write a single rendering test that asserts the key warning text is present. This component is static; one test is enough.

### 6.2 `components/BootSequence.test.ts` — [src/components/BootSequence.vue](src/components/BootSequence.vue)

Read the component first to see what it actually does. Likely behavior: it ticks through boot lines on a timer and emits `done` when finished. Test plan:

- Use `vi.useFakeTimers()` and advance time, asserting that the `done` event is emitted exactly once at the end
- Snapshot the final rendered output (one snapshot here is fine — boot text rarely changes)

If the component uses real `requestAnimationFrame` or `setTimeout`, fake timers will work. If it uses a Vue lifecycle hook with no timer, just `await flushPromises()`.

### 6.3 `components/Terminal.test.ts` — [src/components/Terminal.vue](src/components/Terminal.vue)

Read the component first. Tests to write:

- Renders all lines in `session.scrollback` with their `kind` reflected as a class or attribute
- Typing a command and submitting routes to `runCommand` (mock the commands module or assert via a side effect on `session.scrollback`)
- Typing `reboot` emits the `reboot` event instead of dispatching to the command (this is the interception path mentioned in [commands.ts:317](src/terminal/commands.ts#L317))
- In chat mode, input is routed to `sendChat` instead of `runCommand`

This file will be the longest component test. If `Terminal.vue` is large or stateful enough that mounting it is painful, write only the routing tests (commands vs chat vs reboot) and skip rendering snapshots.

---

## 7. Out of scope (do not write these as Vitest)

- WebLLM model download / inference — needs WebGPU + GBs of model weights
- WebGPU adapter behavior beyond stub-level (covered by §3.5)
- Boot → terminal → chat full journey — that is a Playwright e2e concern
- Visual / CSS / theme color rendering

If any of these feel necessary, leave a TODO comment in the relevant test file rather than introducing skipped tests that rot.

---

## 8. Implementation order

Do them in this order. Each step should land green before moving on.

1. §1 setup: deps, vitest config block, scripts, `tests/setup.ts`, `tests/helpers/`
2. §3 pure-module unit tests (parser, registries, themes, webgpu) — these will validate the harness itself
3. §4 session + chat-stream tests
4. §5 command tests, in the order they appear above. The tricky one is `load.test.ts` (§5.7) — read its notes carefully before starting.
5. §6 component tests, only if time allows

After each test file: run `pnpm test:run` and confirm green before moving on. Do not batch ten files and debug at the end — the session-singleton state means a leak in one test will manifest as a confusing failure in an unrelated one.

---

## 9. Things that will bite you

- **`session` is a module-level singleton.** Always reset in `beforeEach` (the global setup in §1.5 handles this; do not skip it).
- **`engineRef` is a `shallowRef`, not part of `session`.** Reset it separately. The helper in §2.1 does this.
- **`pushProgress` and `beginChatReply` return reactive proxies.** Tests asserting on `.text` / `.progress` / `.streaming` mutation must use the returned reference, not look up by index in `scrollback` (well, both work, but the returned reference is clearer).
- **`vi.mock` is hoisted to the top of the file** regardless of where you write it. The import below the mock call still resolves to the mocked module. Do not try to be clever with conditional mocking.
- **`@mlc-ai/web-llm` should never be imported transitively in a test run.** It is excluded from `optimizeDeps` in [vite.config.ts:21](vite.config.ts#L21) and is heavy. The mock in §5.7 prevents the dynamic import in `loadFirmware` from ever firing. If you see Vitest trying to resolve `@mlc-ai/web-llm`, you forgot to mock `@/firmware/loader` somewhere.
- **jsdom does not implement WebGPU.** Any code path that hits `navigator.gpu` without stubbing will fail. The unit tests in §3.5 are the only place that should touch it.
- **`document.documentElement.dataset.theme` persists across tests** unless reset. The setup file in §1.5 handles this — if you skip it, `theme.test.ts` will pass in isolation and fail in a full run.
- **Do not snapshot full scrollback arrays.** Copy/paste churn in command output will make the snapshots a maintenance tax. Assert on individual `{ kind, text }` lines.
- **Do not write `.skip` tests as TODOs.** Either implement them or leave a `// TODO` comment. Skipped tests rot silently.
