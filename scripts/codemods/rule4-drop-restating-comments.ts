import { collectSources, rel } from "./lib/files.js";
import { extractScripts, read, replaceScripts, write } from "./lib/vue.js";

const ROOT = new URL("../..", import.meta.url).pathname;
const ROOTS = [`${ROOT}/src`, `${ROOT}/packages/opensona/src`];

const APPLY = process.argv.includes("--apply");

const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "this",
  "that",
  "these",
  "those",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "of",
  "for",
  "to",
  "with",
  "and",
  "or",
  "in",
  "on",
  "at",
  "by",
  "as",
  "it",
  "its",
  "if",
  "then",
  "else",
  "from",
  "into",
  "out",
  "up",
  "down",
  "new",
]);

const INTENT_MARKERS = [
  "todo",
  "fixme",
  "xxx",
  "hack",
  "note",
  "warn",
  "warning",
  "because",
  "why",
  "so that",
  "otherwise",
  "needed",
  "avoid",
  "workaround",
  "bug",
  "edge",
  "case",
  "assume",
  "invariant",
  "gotcha",
  "eslint-disable",
  "ts-expect-error",
  "ts-ignore",
  "c8",
  "istanbul",
];

/** Tokenize a line of code into identifier-like lowercase subwords (length >= 2). */
const tokenizeCode = (line: string): Set<string> => {
  const out = new Set<string>();
  const ids = line.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
  for (const id of ids) {
    out.add(id.toLowerCase());
    const parts = id.split(/(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])|_+/);
    for (const p of parts) {
      if (p.length < 2) continue;
      out.add(p.toLowerCase());
    }
  }
  return out;
};

/** Tokenize a comment body into lowercase content words, minus stopwords. */
const tokenizeComment = (body: string): string[] => {
  return body
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
};

/** True if the comment body contains an intent marker suggesting it adds context. */
const hasIntentMarker = (body: string): boolean => {
  const lower = body.toLowerCase();
  if (lower.includes("?")) return true;
  if (/\b\d{3,}\b/.test(body)) return true;
  if (/https?:\/\//i.test(body)) return true;
  for (const m of INTENT_MARKERS) if (lower.includes(m)) return true;
  return false;
};

type Line = { raw: string; start: number; end: number };

/** Split source text into line records with byte offsets (newline included in end). */
const splitLines = (src: string): Line[] => {
  const out: Line[] = [];
  let pos = 0;
  for (const raw of src.split(/(?<=\n)/)) {
    out.push({ raw, start: pos, end: pos + raw.length });
    pos += raw.length;
  }
  return out;
};

/** Match a pure single-line `// comment` line (allow indentation); returns the comment body. */
const pureLineComment = (raw: string): { indent: string; body: string } | null => {
  const m = raw.match(/^([ \t]*)\/\/(?!\/|!|@ts-|eslint-)\s?(.*?)\s*\r?\n?$/);
  if (!m) return null;
  return { indent: m[1], body: m[2] };
};

/** True if a line has any non-whitespace content. */
const isBlank = (raw: string): boolean => /^\s*$/.test(raw);

/** Decide if the comment on line `i` is a restatement of the next code line. */
const isRestating = (lines: Line[], i: number): boolean => {
  const c = pureLineComment(lines[i].raw);
  if (!c) return false;
  const body = c.body;
  if (body.length === 0) return false;
  if (hasIntentMarker(body)) return false;
  const words = tokenizeComment(body);
  if (words.length === 0) return false;
  if (words.length > 6) return false;

  if (i > 0) {
    const prev = lines[i - 1];
    if (pureLineComment(prev.raw)) return false;
  }
  if (i + 1 < lines.length) {
    const next = lines[i + 1];
    if (pureLineComment(next.raw)) return false;
  }

  let nextCodeIdx = i + 1;
  while (nextCodeIdx < lines.length && isBlank(lines[nextCodeIdx].raw)) nextCodeIdx++;
  if (nextCodeIdx >= lines.length) return false;
  const codeLine = lines[nextCodeIdx].raw;
  if (pureLineComment(codeLine)) return false;

  const codeTokens = tokenizeCode(codeLine);
  for (const w of words) {
    let matched = false;
    for (const t of codeTokens) {
      if (t === w) {
        matched = true;
        break;
      }
      if (w.length >= 4 && t.length >= 4 && (t.includes(w) || w.includes(t))) {
        matched = true;
        break;
      }
      if (w.length >= 3 && (t === `${w}s` || `${w}s` === t || w === `${t}s`)) {
        matched = true;
        break;
      }
    }
    if (!matched) return false;
  }
  return true;
};

/** Drop restating single-line comments from the source text. */
const rewriteSource = (src: string): string | null => {
  const lines = splitLines(src);
  const drop = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    if (i === 0) continue;
    if (isRestating(lines, i)) drop.add(i);
  }
  if (drop.size === 0) return null;
  let out = "";
  for (let i = 0; i < lines.length; i++) {
    if (drop.has(i)) continue;
    out += lines[i].raw;
  }
  return out;
};

/** Process one file, returning true if the source was rewritten. */
const processFile = (filePath: string): boolean => {
  const src = read(filePath);
  if (filePath.endsWith(".ts")) {
    const out = rewriteSource(src);
    if (out == null || out === src) return false;
    if (APPLY) write(filePath, out);
    return true;
  }
  const blocks = extractScripts(src);
  if (blocks.length === 0) return false;
  const newInners: string[] = [];
  let anyChanged = false;
  for (let i = 0; i < blocks.length; i++) {
    const out = rewriteSource(blocks[i].inner);
    if (out == null) {
      newInners.push(blocks[i].inner);
    } else {
      newInners.push(out);
      anyChanged = true;
    }
  }
  if (!anyChanged) return false;
  if (APPLY) write(filePath, replaceScripts(src, blocks, newInners));
  return true;
};

const main = () => {
  const all = ROOTS.flatMap((r) => collectSources(r));
  const changed: string[] = [];
  for (const f of all) if (processFile(f)) changed.push(rel(f, ROOT));
  const mode = APPLY ? "APPLIED" : "DRY RUN";
  console.log(`[rule4 ${mode}] ${changed.length} file(s) changed`);
  for (const c of changed) console.log(`  ${c}`);
};

main();
