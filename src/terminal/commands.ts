import { engrams, findEngram } from "@/engrams";
import { firmware, findFirmware } from "@/firmware";
import { loadFirmware } from "@/firmware/loader";
import { themes, applyTheme } from "@/themes";
import { streamReply } from "@/llm/chat";
import {
  engineRef,
  ragRef,
  print,
  printLines,
  pushProgress,
  clearScrollback,
  beginChatReply,
  finishChatReply,
  finishProgress,
} from "./session";
import { useSessionStore } from "@/stores/session";
import { useChatStore } from "@/stores/chat";
import type {
  CharacterContext,
  GetTraversalPath,
  ResolverInput,
  ResolverMessage,
  RetrievedChunk,
  TraversalDirective,
  TraverseTrace,
} from "opensona/runtime";
import { appendRagLog } from "./ragLog";
import type { ResolverFallback } from "@/stores/rag";
import { createCachedFetcher, sweepStale } from "@/storage/bundleCache";

export type Command = {
  name: string;
  usage: string;
  summary: string;
  run: (args: string[]) => Promise<void> | void;
};

/** Pad a string to a column width (space-padded, right side). */
function pad(s: string, n: number): string {
  if (s.length >= n) return s.slice(0, n);
  return s + " ".repeat(n - s.length);
}

function unknown(cmd: string): void {
  print(`mikoshi: unknown command: ${cmd}`, "error");
  print("type 'help' for a list of available commands.", "info");
}

export const commands: Command[] = [
  {
    name: "help",
    usage: "help [command]",
    summary: "List commands, or show help for one",
    run(args) {
      if (args.length === 0) {
        print("AVAILABLE COMMANDS", "info");
        print("", "out");
        for (const c of commands) {
          print(`  ${pad(c.name, 16)} ${c.summary}`, "out");
        }
        print("", "out");
        print("type 'help <command>' for usage details.", "info");
        return;
      }
      const target = commands.find((c) => c.name === args[0]);
      if (!target) return unknown(args[0]!);
      print(`USAGE   ${target.usage}`, "info");
      print(`        ${target.summary}`, "out");
    },
  },
  {
    name: "clear",
    usage: "clear",
    summary: "Clear the terminal scrollback",
    run() {
      clearScrollback();
    },
  },
  {
    name: "whoami",
    usage: "whoami",
    summary: "Display current session identity",
    run() {
      print("guest@mikoshi // unauthenticated // read-only cradle", "out");
      print("access tier: PUBLIC // quota: unlimited // logged: YES", "out");
    },
  },
  {
    name: "status",
    usage: "status",
    summary: "Show current engram, firmware, theme, and mode",
    run() {
      const store = useSessionStore();
      const fw = store.currentFirmwareId ? findFirmware(store.currentFirmwareId) : null;
      const eg = store.currentEngramId ? findEngram(store.currentEngramId) : null;
      print("SESSION STATUS", "info");
      print("", "out");
      print(`  mode:     ${store.mode}`, "out");
      print(`  theme:    ${store.theme}`, "out");
      print(`  firmware: ${fw?.displayName ?? "<none>"}`, "out");
      print(`  engram:   ${eg?.displayName ?? "<none>"}`, "out");
      print(`  engine:   ${engineRef.value ? "online" : "offline"}`, "out");
    },
  },
  {
    name: "ls",
    usage: "ls <engrams|firmware|themes>",
    summary: "List available engrams, firmware, or themes",
    run(args) {
      const target = args[0];
      if (!target) {
        print("usage: ls <engrams|firmware|themes>", "error");
        return;
      }
      if (target === "engrams") {
        print("AVAILABLE ENGRAMS", "info");
        print("", "out");
        for (const e of engrams) {
          print(`  ${pad(e.id, 22)} ${pad(e.displayName, 22)} ${e.era}`, "out");
        }
        print("", "out");
        print("type 'info engram <id>' for details.", "info");
      } else if (target === "firmware") {
        print("AVAILABLE FIRMWARE", "info");
        print("", "out");
        for (const f of firmware) {
          print(`  ${pad(f.id, 22)} ${pad(f.displayName, 28)} ~${f.approxSizeMB}MB`, "out");
        }
        print("", "out");
        print("type 'info firmware <id>' for details.", "info");
      } else if (target === "themes") {
        print("AVAILABLE THEMES", "info");
        print("", "out");
        for (const t of themes) {
          print(`  ${pad(t.id, 14)} ${pad(t.displayName, 14)} ${t.description}`, "out");
        }
      } else {
        print(`ls: unknown target: ${target}`, "error");
      }
    },
  },
  {
    name: "info",
    usage: "info <engram|firmware> <id>",
    summary: "Show detailed info for an engram or firmware",
    run(args) {
      if (args.length < 2) {
        print("usage: info <engram|firmware> <id>", "error");
        return;
      }
      const [kind, id] = args;
      if (kind === "engram") {
        const e = findEngram(id!);
        if (!e) {
          print(`info: no such engram: ${id}`, "error");
          return;
        }
        print(`ENGRAM :: ${e.displayName}`, "info");
        print("", "out");
        print(`  handle:   ${e.handle}`, "out");
        print(`  era:      ${e.era}`, "out");
        print("", "out");
        print("  BIO", "info");
        print(`  ${e.bio}`, "out");
      } else if (kind === "firmware") {
        const f = findFirmware(id!);
        if (!f) {
          print(`info: no such firmware: ${id}`, "error");
          return;
        }
        print(`FIRMWARE :: ${f.displayName}`, "info");
        print("", "out");
        print(`  manufacturer: ${f.manufacturer}`, "out");
        print(`  model_id:     ${f.mlcModelId}`, "out");
        print(`  approx size:  ~${f.approxSizeMB}MB`, "out");
        print("", "out");
        print(`  ${f.description}`, "out");
      } else {
        print(`info: unknown kind: ${kind}`, "error");
      }
    },
  },
  {
    name: "load",
    usage: "load firmware <id>",
    summary: "Download and flash a biochip firmware (WebLLM model)",
    async run(args) {
      if (args.length < 2 || args[0] !== "firmware") {
        print("usage: load firmware <id>", "error");
        return;
      }
      const id = args[1]!;
      const f = findFirmware(id);
      if (!f) {
        print(`load: no such firmware: ${id}`, "error");
        return;
      }
      const store = useSessionStore();
      if (store.mode === "loading") {
        print("load: another firmware is already flashing.", "error");
        return;
      }
      store.mode = "loading";
      print(`>> flashing biochip: ${f.displayName}`, "info");
      print(`>> source: ${f.mlcModelId} (~${f.approxSizeMB}MB)`, "info");
      const fwProgress = pushProgress("[          ]   0%  initializing firmware");
      const ragProgress = pushProgress("[          ]   0%  initializing lore db");

      function formatBar(pct: number, label: string): string {
        const clamped = Math.max(0, Math.min(1, pct));
        const bars = Math.round(clamped * 20);
        const bar = "#".repeat(bars) + "-".repeat(20 - bars);
        return `[${bar}] ${Math.round(clamped * 100)
          .toString()
          .padStart(3, " ")}%  ${label.slice(0, 60)}`;
      }

      try {
        // Load firmware and RAG bundle in parallel
        const firmwarePromise = loadFirmware(f, (p) => {
          fwProgress.progress = p.progress;
          fwProgress.text = formatBar(p.progress, p.text);
        });

        const ragPromise = (async () => {
          try {
            const { createRuntime } = await import("opensona/runtime");
            const runtime = createRuntime();
            await runtime.load("/rag/", {
              onProgress: (p) => {
                ragProgress.progress = p.ratio;
                ragProgress.text = formatBar(p.ratio, p.phase);
              },
              fetchOverride: createCachedFetcher(),
            });
            // Fire-and-forget stale-sha sweep once the manifest is known.
            const manifest = runtime.manifest();
            if (manifest) {
              const keep = new Set<string>(Object.values(manifest.files).map((f) => f.sha256));
              void sweepStale(keep).catch(() => {
                // Sweep is best-effort housekeeping; ignore failures.
              });
            }
            return runtime;
          } catch (err) {
            // RAG is best-effort — don't block firmware loading
            const msg = err instanceof Error ? err.message : String(err);
            ragProgress.text = formatBar(0, `lore db unavailable: ${msg}`);
            finishProgress(ragProgress);
            return null;
          }
        })();

        const [engine, ragRuntime] = await Promise.all([firmwarePromise, ragPromise]);

        engineRef.value = engine;
        store.currentFirmwareId = f.id;
        fwProgress.progress = 1;
        fwProgress.text = formatBar(1, "FLASH COMPLETE");
        finishProgress(fwProgress);

        if (ragRuntime) {
          ragRef.value = ragRuntime;
          ragProgress.progress = 1;
          ragProgress.text = formatBar(1, "LORE DB ONLINE");
          finishProgress(ragProgress);
        }

        // Yield so Vue paints the final progress bars before printing below.
        await new Promise((r) => setTimeout(r, 0));
        print(`>> biochip online: ${f.displayName}`, "info");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        print(`>> flash failed: ${msg}`, "error");
        // Persist whatever progress state the bars ended at so the failure is
        // visible in scrollback on refresh.
        finishProgress(fwProgress);
        finishProgress(ragProgress);
      } finally {
        store.mode = "shell";
      }
    },
  },
  {
    name: "jack-in",
    usage: "jack-in <engram-id>",
    summary: "Open a neural link to a stored engram",
    run(args) {
      if (args.length < 1) {
        print("usage: jack-in <engram-id>", "error");
        return;
      }
      const store = useSessionStore();
      const fw = store.currentFirmwareId ? findFirmware(store.currentFirmwareId) : null;
      if (!engineRef.value || !fw) {
        print("jack-in: no firmware loaded.", "error");
        print("run 'ls firmware' then 'load firmware <id>' first.", "info");
        return;
      }
      const e = findEngram(args[0]!);
      if (!e) {
        print(`jack-in: no such engram: ${args[0]}`, "error");
        return;
      }
      store.currentEngramId = e.id;
      // Pre-compute the entity vocab for the resolver prompt. Throws if the
      // engram article isn't in the graph — callers treat that as non-fatal.
      try {
        ragRef.value?.warmEngram(e.id);
      } catch (err) {
        console.warn(`[rag] warmEngram failed for ${e.id}`, err);
      }
      const chat = useChatStore();
      // Fresh link: wipe any prior conversation, (re)bind firmware+engram.
      chat.chatHistory = [];
      chat.startedAt = 0;
      chat.lastTurnAt = 0;
      chat.firmwareId = store.currentFirmwareId;
      chat.engramId = e.id;
      store.mode = "chat";
      printLines(
        [
          "",
          "================================================================",
          `  NEURAL LINK ESTABLISHED :: ${e.displayName}`,
          `  firmware: ${fw.displayName}`,
          `  handle:   ${e.handle}`,
          "  type '/disconnect' to close the link. '/help' for more.",
          "================================================================",
          "",
        ],
        "banner",
      );
    },
  },
  {
    name: "disconnect",
    usage: "disconnect",
    summary: "Close the active neural link",
    run() {
      const store = useSessionStore();
      if (store.mode !== "chat") {
        print("disconnect: no active link.", "error");
        return;
      }
      const eg = store.currentEngramId ? findEngram(store.currentEngramId) : null;
      const name = eg?.displayName ?? "engram";
      store.mode = "shell";
      store.currentEngramId = null;
      // Per PLAN §7: disconnect clears the persisted session so the next
      // boot doesn't prompt to resume a severed link. Fire-and-forget; the
      // UI continues without awaiting the IDB wipe.
      void useChatStore().clear();
      printLines(
        ["", `>> link to ${name} severed.`, ">> flushing cradle buffers...", ""],
        "banner",
      );
    },
  },
  {
    name: "theme",
    usage: "theme <list|set> [id]",
    summary: "List themes or switch the active theme",
    run(args) {
      if (args[0] === "list" || args.length === 0) {
        for (const t of themes) {
          print(`  ${pad(t.id, 14)} ${t.description}`, "out");
        }
        return;
      }
      if (args[0] === "set") {
        const id = args[1];
        if (!id) {
          print("usage: theme set <id>", "error");
          return;
        }
        if (!themes.some((t) => t.id === id)) {
          print(`theme: unknown theme: ${id}`, "error");
          return;
        }
        applyTheme(id);
        useSessionStore().theme = id;
        print(`>> theme set: ${id}`, "info");
        return;
      }
      print("usage: theme <list|set> [id]", "error");
    },
  },
  {
    name: "reboot",
    usage: "reboot",
    summary: "Re-run the boot sequence",
    run() {
      // Intercepted by Terminal.vue before it reaches the dispatcher — this
      // body only runs if something routes here directly.
      print(">> rebooting cradle...", "info");
    },
  },
];

/** Run a shell command by parsed name. */
export async function runCommand(name: string, args: string[]): Promise<void> {
  const cmd = commands.find((c) => c.name === name);
  if (!cmd) {
    unknown(name);
    return;
  }
  await cmd.run(args);
}

/**
 * Slash commands available inside a neural link. `/` is the escape prefix —
 * anything else the user types in chat mode is forwarded to the engram as a
 * chat message. Keeping these separate from the shell `commands` list lets the
 * in-link vocabulary stay small and thematic.
 */
type SlashCommand = {
  name: string;
  summary: string;
  run: (args: string[]) => Promise<void> | void;
};

/**
 * Approximate context window of the firmware in this catalog. All three
 * WebLLM prebuilt configs (Hermes-3-Llama-3.2-3B, Llama-3.1-8B-Instruct,
 * Hermes-3-Llama-3.1-8B) ship with a 4096-token runtime window, so we treat
 * that as the denominator for the engram-integrity meter.
 */
const APPROX_CONTEXT_TOKENS = 4096;

/** Rough char-per-token estimate for Llama-family BPE tokenizers. */
const CHARS_PER_TOKEN = 4;

/**
 * Character budget for the per-turn lore preamble. Graph-RAG traversal emits up
 * to 40 whole article sections, which easily exceeds the 4096-token wasm ceiling
 * once stacked alongside the engram system prompt (~2250 tokens for V),
 * restored chat history, and the response allocation. Chunks arrive sorted by
 * hops asc, so we keep prefix chunks until the budget is exhausted.
 *
 * Why: on chat resume, the restored history is piled on top of a fresh
 * preamble each turn — unbounded preambles that "just fit" on turn 1 blow up
 * on turn 2. Capping at assembly time keeps both fresh-load and resume paths
 * inside the window.
 */
const PREAMBLE_CHAR_BUDGET = 2800;

const slashCommands: SlashCommand[] = [
  {
    name: "disconnect",
    summary: "Close the active neural link",
    run: () => runCommand("disconnect", []),
  },
  {
    name: "status",
    summary: "Show link status and engram integrity",
    run() {
      const store = useSessionStore();
      const engram = store.currentEngramId ? findEngram(store.currentEngramId) : null;
      const fw = store.currentFirmwareId ? findFirmware(store.currentFirmwareId) : null;
      if (!engram || !fw) {
        print("status: no active link.", "error");
        return;
      }
      const chat = useChatStore();
      const promptChars = engram.systemPrompt.length;
      const historyChars = chat.chatHistory.reduce((n, m) => n + m.content.length, 0);
      const approxTokens = Math.ceil((promptChars + historyChars) / CHARS_PER_TOKEN);
      // Integrity inverts context usage — a full context means the engram's
      // memory buffers are saturated and the persona starts to degrade.
      const usage = Math.min(1, approxTokens / APPROX_CONTEXT_TOKENS);
      const integrity = 1 - usage;
      const bars = Math.round(integrity * 20);
      const bar = "#".repeat(bars) + "-".repeat(20 - bars);
      const turns = Math.floor(chat.chatHistory.length / 2);

      print("NEURAL LINK STATUS", "info");
      print("", "out");
      print(`  engram:    ${engram.displayName}`, "out");
      print(`  handle:    ${engram.handle}`, "out");
      print(`  firmware:  ${fw.displayName}`, "out");
      print(`  turns:     ${turns}`, "out");
      print(
        `  integrity: [${bar}] ${Math.round(integrity * 100)}%  (${approxTokens}/${APPROX_CONTEXT_TOKENS} tok)`,
        "out",
      );
    },
  },
  {
    name: "clear",
    summary: "Clear the terminal scrollback",
    run() {
      clearScrollback();
    },
  },
  {
    name: "help",
    summary: "List link commands",
    run() {
      print("LINK COMMANDS", "info");
      print("", "out");
      for (const c of slashCommands) {
        print(`  ${pad("/" + c.name, 16)} ${c.summary}`, "out");
      }
      print("", "out");
      print("anything without a leading '/' is spoken to the engram.", "info");
    },
  },
];

/**
 * Dispatch a slash command typed inside chat mode. Input is the raw line,
 * including the leading `/`.
 */
export async function runSlashCommand(input: string): Promise<void> {
  const body = input.trim().slice(1).trim();
  if (!body) {
    print("type '/help' for link commands.", "info");
    return;
  }
  const [name, ...args] = body.split(/\s+/);
  const cmd = slashCommands.find((c) => c.name === name);
  if (!cmd) {
    print(`unknown link command: /${name}`, "error");
    print("type '/help' for link commands.", "info");
    return;
  }
  await cmd.run(args);
}

/**
 * Full per-turn retrieval result — opensona runs the graph traversal, the
 * caller runs the LLM resolver. Everything that feeds the debug log is
 * captured here so `sendChat` only has to forward it.
 */
type RetrievalBundle = {
  preamble: string;
  chunks: RetrievedChunk[];
  resolverInput: ResolverInput | null;
  resolverMessages: ResolverMessage[];
  resolverRaw: string;
  resolverOutput: TraversalDirective | { error: string; raw: string } | null;
  resolverFallback: ResolverFallback;
  resolvedEntities: Array<{ alias: string; articleId: string }>;
  traversalNodes: TraverseTrace["nodes"];
  timing: Record<string, number>;
};

const TRAVERSAL_DIRECTIVE_SCHEMA = JSON.stringify({
  type: "object",
  properties: {
    entities: { type: "array", items: { type: "string" } },
    neighbors: { type: "string", enum: ["none", "direct", "two_hop"] },
    include_categories: { type: "array", items: { type: "string" } },
    reasoning: { type: "string" },
  },
  required: ["entities", "neighbors", "include_categories"],
});

const EMPTY_RETRIEVAL: RetrievalBundle = {
  preamble: "",
  chunks: [],
  resolverInput: null,
  resolverMessages: [],
  resolverRaw: "",
  resolverOutput: null,
  resolverFallback: "none",
  resolvedEntities: [],
  traversalNodes: [],
  timing: {},
};

async function retrieveLore(userInput: string): Promise<RetrievalBundle> {
  const rag = ragRef.value;
  const engine = engineRef.value;
  const store = useSessionStore();
  const engram = store.currentEngramId ? findEngram(store.currentEngramId) : null;
  if (!rag || !engine || !engram) return EMPTY_RETRIEVAL;

  const { buildResolverMessages, parseTraversalDirective, assembleLorePreamble } =
    await import("opensona/runtime");

  const characterContext: CharacterContext = {
    id: engram.id,
    bio: engram.bio,
    ...(engram.cutoffEventId ? { cutoffEventId: engram.cutoffEventId } : {}),
    ...(engram.excludeTags ? { excludeTags: engram.excludeTags } : {}),
  };

  // The caller owns the LLM round-trip. Capture the raw output and the parsed
  // directive so both land in the debug log regardless of the outcome.
  let capturedInput: ResolverInput | null = null;
  let capturedMessages: ResolverMessage[] = [];
  let capturedRaw = "";
  let parsedDirective: TraversalDirective | null = null;
  let fallback: ResolverFallback = "none";
  let resolveMs = 0;

  const getTraversalPath: GetTraversalPath = async (input) => {
    capturedInput = input;
    capturedMessages = buildResolverMessages(input);
    const tResolve = performance.now();
    try {
      const resp = await engine.chat.completions.create({
        messages: capturedMessages,
        response_format: {
          type: "json_object",
          schema: TRAVERSAL_DIRECTIVE_SCHEMA,
        },
        temperature: 0.1,
        max_tokens: 120,
        stream: false,
      });
      capturedRaw = resp.choices?.[0]?.message?.content ?? "";
    } catch (err) {
      fallback = "throw";
      throw err;
    } finally {
      resolveMs = Math.round(performance.now() - tResolve);
    }
    parsedDirective = parseTraversalDirective(capturedRaw);
    if (!parsedDirective) {
      fallback = "parse-error";
      return null;
    }
    if (parsedDirective.entities.length === 0) {
      fallback = "empty-directive";
    }
    return parsedDirective;
  };

  const traceHolder: { trace: TraverseTrace | null } = { trace: null };

  const timing: Record<string, number> = {};
  try {
    const tTotal = performance.now();
    const chunks = await rag.query(userInput, {
      getTraversalPath,
      characterContext,
      onTrace: (trace) => {
        traceHolder.trace = trace;
      },
    });
    timing.resolve = resolveMs;
    timing.traverse = Math.round(performance.now() - tTotal) - resolveMs;

    const resolverOutput: RetrievalBundle["resolverOutput"] =
      parsedDirective ?? (capturedRaw ? { error: "parse-error", raw: capturedRaw } : null);

    if (chunks.length === 0) {
      return {
        ...EMPTY_RETRIEVAL,
        resolverInput: capturedInput,
        resolverMessages: capturedMessages,
        resolverRaw: capturedRaw,
        resolverOutput,
        resolverFallback: fallback === "none" ? "empty-directive" : fallback,
        resolvedEntities: traceHolder.trace?.resolvedEntities ?? [],
        traversalNodes: traceHolder.trace?.nodes ?? [],
        timing,
      };
    }

    const tAssemble = performance.now();
    const manifest = rag.manifest();
    const meta = {
      source: manifest?.source ?? "",
      license: manifest?.license ?? "",
    };
    // Keep only enough prefix chunks (hops-sorted) to fit the preamble budget.
    // We count raw chunk text, not the assembled wrapper, so the budget tracks
    // the dominant cost regardless of the <lore> scaffolding around it.
    const budgetedChunks: RetrievedChunk[] = [];
    let chunkCharTotal = 0;
    for (const c of chunks) {
      const cost = c.chunk.header.length + c.chunk.text.length + 1;
      if (budgetedChunks.length > 0 && chunkCharTotal + cost > PREAMBLE_CHAR_BUDGET) break;
      budgetedChunks.push(c);
      chunkCharTotal += cost;
    }
    const preamble = assembleLorePreamble(budgetedChunks, meta);
    timing.assemble = Math.round(performance.now() - tAssemble);

    return {
      preamble,
      chunks: budgetedChunks,
      resolverInput: capturedInput,
      resolverMessages: capturedMessages,
      resolverRaw: capturedRaw,
      resolverOutput,
      resolverFallback: fallback,
      resolvedEntities: traceHolder.trace?.resolvedEntities ?? [],
      traversalNodes: traceHolder.trace?.nodes ?? [],
      timing,
    };
  } catch (err) {
    console.warn("[rag] retrieval failed:", err);
    return {
      ...EMPTY_RETRIEVAL,
      resolverInput: capturedInput,
      resolverMessages: capturedMessages,
      resolverRaw: capturedRaw,
      resolverOutput: capturedRaw ? { error: String(err), raw: capturedRaw } : null,
      resolverFallback: "throw",
      timing,
    };
  }
}

/** Handle free-form chat input while in chat mode. */
export async function sendChat(userInput: string): Promise<void> {
  const engine = engineRef.value;
  const store = useSessionStore();
  const engram = store.currentEngramId ? findEngram(store.currentEngramId) : null;
  if (!engine || !engram) {
    print("chat: link is down. use '/disconnect'.", "error");
    return;
  }
  print(userInput, "chat-user");

  // RAG retrieval (best-effort)
  const tTurnStart = performance.now();
  const retrieval = await retrieveLore(userInput);
  const lorePreamble = retrieval.preamble;
  // Compose the system content the way streamReply does, so the logged
  // systemPrompt mirrors what actually reaches the model.
  const composedSystemPrompt = lorePreamble
    ? `${lorePreamble}\n\n${engram.systemPrompt}`
    : engram.systemPrompt;
  appendRagLog({
    query: userInput,
    engramId: engram.id,
    cutoffEventId: engram.cutoffEventId ?? null,
    resolverInput: retrieval.resolverInput,
    resolverMessages: retrieval.resolverMessages,
    resolverRaw: retrieval.resolverRaw,
    resolverOutput: retrieval.resolverOutput,
    resolverFallback: retrieval.resolverFallback,
    resolvedEntities: retrieval.resolvedEntities,
    traversalNodes: retrieval.traversalNodes,
    selected: retrieval.chunks,
    preamble: lorePreamble,
    systemPrompt: composedSystemPrompt,
    timing: {
      ...retrieval.timing,
      total: Math.round(performance.now() - tTurnStart),
    },
  });

  const chat = useChatStore();
  const replyLine = beginChatReply();
  try {
    for await (const chunk of streamReply(
      engine,
      engram.systemPrompt,
      chat.chatHistory,
      userInput,
      lorePreamble || undefined,
    )) {
      if (chunk.delta) replyLine.text += chunk.delta;
      if (chunk.done) replyLine.streaming = false;
    }
    chat.appendTurn("user", userInput);
    chat.appendTurn("assistant", replyLine.text);
    finishChatReply(replyLine);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    replyLine.streaming = false;
    replyLine.text += `\n[link error: ${msg}]`;
    finishChatReply(replyLine);
  }
}
