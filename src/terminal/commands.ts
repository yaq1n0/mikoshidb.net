import { engrams, findEngram } from "@/engrams";
import { firmware, findFirmware } from "@/firmware";
import { loadFirmware } from "@/firmware/loader";
import { themes, applyTheme } from "@/themes";
import { streamReply } from "@/llm/chat";
import {
  session,
  engineRef,
  ragRef,
  print,
  printLines,
  pushProgress,
  clearScrollback,
  beginChatReply,
} from "./session";
import type { RetrievedChunk } from "opensona/runtime";
import { appendRagLog } from "./ragLog";

export interface Command {
  name: string;
  usage: string;
  summary: string;
  run: (args: string[]) => Promise<void> | void;
}

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
      print("SESSION STATUS", "info");
      print("", "out");
      print(`  mode:     ${session.mode}`, "out");
      print(`  theme:    ${session.theme}`, "out");
      print(`  firmware: ${session.currentFirmware?.displayName ?? "<none>"}`, "out");
      print(`  engram:   ${session.currentEngram?.displayName ?? "<none>"}`, "out");
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
      if (session.mode === "loading") {
        print("load: another firmware is already flashing.", "error");
        return;
      }
      session.mode = "loading";
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
            await runtime.load("/rag/", (p) => {
              ragProgress.progress = p.ratio;
              ragProgress.text = formatBar(p.ratio, p.phase);
            });
            return runtime;
          } catch (err) {
            // RAG is best-effort — don't block firmware loading
            const msg = err instanceof Error ? err.message : String(err);
            ragProgress.text = formatBar(0, `lore db unavailable: ${msg}`);
            return null;
          }
        })();

        const [engine, ragRuntime] = await Promise.all([firmwarePromise, ragPromise]);

        engineRef.value = engine;
        session.currentFirmware = f;
        fwProgress.progress = 1;
        fwProgress.text = formatBar(1, "FLASH COMPLETE");

        if (ragRuntime) {
          ragRef.value = ragRuntime;
          ragProgress.progress = 1;
          ragProgress.text = formatBar(1, "LORE DB ONLINE");
        }

        // Yield so Vue paints the final progress bars before printing below.
        await new Promise((r) => setTimeout(r, 0));
        print(`>> biochip online: ${f.displayName}`, "info");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        print(`>> flash failed: ${msg}`, "error");
      } finally {
        session.mode = "shell";
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
      if (!engineRef.value || !session.currentFirmware) {
        print("jack-in: no firmware loaded.", "error");
        print("run 'ls firmware' then 'load firmware <id>' first.", "info");
        return;
      }
      const e = findEngram(args[0]!);
      if (!e) {
        print(`jack-in: no such engram: ${args[0]}`, "error");
        return;
      }
      session.currentEngram = e;
      session.chatHistory = [];
      session.mode = "chat";
      printLines(
        [
          "",
          "================================================================",
          `  NEURAL LINK ESTABLISHED :: ${e.displayName}`,
          `  firmware: ${session.currentFirmware.displayName}`,
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
      if (session.mode !== "chat") {
        print("disconnect: no active link.", "error");
        return;
      }
      const name = session.currentEngram?.displayName ?? "engram";
      session.mode = "shell";
      session.currentEngram = null;
      session.chatHistory = [];
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
        session.theme = id;
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
interface SlashCommand {
  name: string;
  summary: string;
  run: (args: string[]) => Promise<void> | void;
}

/**
 * Approximate context window of the firmware in this catalog. All three
 * WebLLM prebuilt configs (Hermes-3-Llama-3.2-3B, Llama-3.1-8B-Instruct,
 * Hermes-3-Llama-3.1-8B) ship with a 4096-token runtime window, so we treat
 * that as the denominator for the engram-integrity meter.
 */
const APPROX_CONTEXT_TOKENS = 4096;

/** Rough char-per-token estimate for Llama-family BPE tokenizers. */
const CHARS_PER_TOKEN = 4;

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
      const engram = session.currentEngram;
      const fw = session.currentFirmware;
      if (!engram || !fw) {
        print("status: no active link.", "error");
        return;
      }
      const promptChars = engram.systemPrompt.length;
      const historyChars = session.chatHistory.reduce((n, m) => n + m.content.length, 0);
      const approxTokens = Math.ceil((promptChars + historyChars) / CHARS_PER_TOKEN);
      // Integrity inverts context usage — a full context means the engram's
      // memory buffers are saturated and the persona starts to degrade.
      const usage = Math.min(1, approxTokens / APPROX_CONTEXT_TOKENS);
      const integrity = 1 - usage;
      const bars = Math.round(integrity * 20);
      const bar = "#".repeat(bars) + "-".repeat(20 - bars);
      const turns = Math.floor(session.chatHistory.length / 2);

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
 * Attempt RAG retrieval for the current query. Best-effort: returns empty
 * preamble on any error so the chat still works without lore grounding.
 */
async function retrieveLore(
  userInput: string,
): Promise<{ preamble: string; chunks: RetrievedChunk[] }> {
  const rag = ragRef.value;
  const engram = session.currentEngram;
  if (!rag || !engram) return { preamble: "", chunks: [] };

  try {
    const chunks = await rag.query(userInput, {
      topK: 3,
      cutoffEventId: engram.cutoffEventId,
      excludeTags: engram.excludeTags,
    });

    if (chunks.length === 0) return { preamble: "", chunks: [] };

    // Dynamically import prompt assembly
    const { assembleLorePreamble } = await import("opensona/runtime");
    const manifest = rag.manifest();
    const meta = {
      source: manifest?.source ?? "",
      license: manifest?.license ?? "",
    };
    return { preamble: assembleLorePreamble(chunks, meta), chunks };
  } catch (err) {
    // RAG is best-effort — fall through with empty preamble
    console.warn("[rag] retrieval failed:", err);
    return { preamble: "", chunks: [] };
  }
}

/** Handle free-form chat input while in chat mode. */
export async function sendChat(userInput: string): Promise<void> {
  const engine = engineRef.value;
  const engram = session.currentEngram;
  if (!engine || !engram) {
    print("chat: link is down. use '/disconnect'.", "error");
    return;
  }
  print(userInput, "chat-user");

  // RAG retrieval (best-effort)
  const { preamble: lorePreamble, chunks: retrievedChunks } = await retrieveLore(userInput);
  appendRagLog({
    query: userInput,
    engramId: engram.id,
    cutoffEventId: engram.cutoffEventId ?? null,
    chunks: retrievedChunks,
  });

  const replyLine = beginChatReply();
  try {
    for await (const chunk of streamReply(
      engine,
      engram.systemPrompt,
      session.chatHistory,
      userInput,
      lorePreamble || undefined,
    )) {
      if (chunk.delta) replyLine.text += chunk.delta;
      if (chunk.done) replyLine.streaming = false;
    }
    session.chatHistory.push({ role: "user", content: userInput });
    session.chatHistory.push({ role: "assistant", content: replyLine.text });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    replyLine.streaming = false;
    replyLine.text += `\n[link error: ${msg}]`;
  }
}
