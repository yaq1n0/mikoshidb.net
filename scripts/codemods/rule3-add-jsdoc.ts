import {
  Project,
  Node,
  FunctionDeclaration,
  VariableStatement,
  ArrowFunction,
  FunctionExpression,
} from "ts-morph";
import { collectSources, rel } from "./lib/files.js";
import { extractScripts, read, replaceScripts, write } from "./lib/vue.js";

const ROOT = new URL("../..", import.meta.url).pathname;
const ROOTS = [`${ROOT}/src`, `${ROOT}/packages/opensona/src`];

const APPLY = process.argv.includes("--apply");

type Edit = { start: number; end: number; replacement: string };

const VERB_PHRASES: Record<string, string> = {
  get: "Returns",
  fetch: "Fetches",
  load: "Loads",
  read: "Reads",
  set: "Sets",
  save: "Persists",
  store: "Stores",
  persist: "Persists",
  write: "Writes",
  add: "Adds",
  append: "Appends",
  push: "Appends",
  insert: "Inserts",
  remove: "Removes",
  delete: "Deletes",
  destroy: "Destroys",
  clear: "Clears",
  reset: "Resets",
  create: "Creates",
  make: "Creates",
  build: "Builds",
  spawn: "Spawns",
  init: "Initializes",
  initialize: "Initializes",
  setup: "Sets up",
  start: "Starts",
  stop: "Stops",
  run: "Runs",
  execute: "Executes",
  handle: "Handles",
  process: "Processes",
  parse: "Parses",
  format: "Formats",
  render: "Renders",
  validate: "Validates",
  verify: "Verifies",
  check: "Checks",
  ensure: "Ensures",
  update: "Updates",
  patch: "Patches",
  modify: "Modifies",
  apply: "Applies",
  resolve: "Resolves",
  reject: "Rejects",
  sort: "Sorts",
  filter: "Filters",
  map: "Maps",
  reduce: "Reduces",
  find: "Finds",
  search: "Searches",
  has: "True if",
  is: "True if",
  should: "True if",
  can: "True if",
  will: "True if",
  emit: "Emits",
  dispatch: "Dispatches",
  on: "Handles",
  to: "Converts to",
  from: "Builds from",
  extract: "Extracts",
  split: "Splits",
  join: "Joins",
  merge: "Merges",
  clone: "Clones",
  copy: "Copies",
  hydrate: "Hydrates",
  normalize: "Normalizes",
  denormalize: "Denormalizes",
  sanitize: "Sanitizes",
  slug: "Slugifies",
  slugify: "Slugifies",
  convert: "Converts",
  compute: "Computes",
  calculate: "Computes",
  count: "Counts",
  collect: "Collects",
  plan: "Plans",
  rewrite: "Rewrites",
  replace: "Replaces",
  pack: "Packs",
  unpack: "Unpacks",
  download: "Downloads",
  upload: "Uploads",
  prebuild: "Prebuilds",
  register: "Registers",
  warm: "Warms",
  traverse: "Traverses",
  walk: "Walks",
  call: "Calls",
  invoke: "Invokes",
  open: "Opens",
  close: "Closes",
  use: "Returns",
  with: "Runs with",
  log: "Logs",
  print: "Prints",
};

/** Split an identifier like `createSessionLock` or `DB_KEY` into word tokens. */
const splitName = (name: string): string[] => {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
};

/** Format a trailing noun phrase from remaining name tokens. */
const phraseRest = (rest: string[]): string => {
  if (rest.length === 0) return "";
  return rest.map((t) => t.toLowerCase()).join(" ");
};

/** Generate a one-line JSDoc description from a function's name. */
const describeFromName = (name: string): string => {
  const tokens = splitName(name);
  if (tokens.length === 0) return "TODO: describe.";
  const first = tokens[0].toLowerCase();
  const rest = tokens.slice(1);
  const restPhrase = phraseRest(rest);
  const verb = VERB_PHRASES[first];
  if (verb) {
    if (!restPhrase) return `${verb}.`;
    return `${verb} ${restPhrase}.`;
  }
  const cap = first.charAt(0).toUpperCase() + first.slice(1);
  return restPhrase ? `${cap} ${restPhrase}.` : `${cap}.`;
};

/** Compute the start-of-line indentation for a node's starting position. */
const indentFor = (src: string, pos: number): { lineStart: number; indent: string } => {
  let i = pos;
  while (i > 0 && src[i - 1] !== "\n") i--;
  const indent = src.slice(i, pos).match(/^[ \t]*/)?.[0] ?? "";
  return { lineStart: i, indent };
};

/** True if the given variable statement's single declaration initializes with an arrow/function expr. */
const arrowInitializer = (stmt: VariableStatement): ArrowFunction | FunctionExpression | null => {
  const decls = stmt.getDeclarations();
  if (decls.length !== 1) return null;
  const init = decls[0].getInitializer();
  if (!init) return null;
  if (Node.isArrowFunction(init) || Node.isFunctionExpression(init)) return init;
  return null;
};

/** Return the declaration-name used for JSDoc generation, if this statement is a function binding. */
const getFunctionBindingName = (stmt: VariableStatement): string | null => {
  const decls = stmt.getDeclarations();
  if (decls.length !== 1) return null;
  const nameNode = decls[0].getNameNode();
  if (!Node.isIdentifier(nameNode)) return null;
  return nameNode.getText();
};

type Candidate = {
  name: string;
  start: number;
};

/** Collect function-like top-level declarations missing JSDoc in a source file. */
const collect = (src: ReturnType<Project["createSourceFile"]>): Candidate[] => {
  const out: Candidate[] = [];
  for (const stmt of src.getStatements()) {
    if (Node.isFunctionDeclaration(stmt)) {
      const fn = stmt as FunctionDeclaration;
      const name = fn.getName();
      if (!name) continue;
      if (fn.getJsDocs().length > 0) continue;
      out.push({ name, start: fn.getStart() });
      continue;
    }
    if (Node.isVariableStatement(stmt)) {
      const vs = stmt as VariableStatement;
      if (!arrowInitializer(vs)) continue;
      const name = getFunctionBindingName(vs);
      if (!name) continue;
      if (vs.getJsDocs().length > 0) continue;
      out.push({ name, start: vs.getStart() });
    }
  }
  return out;
};

/** Apply non-overlapping edits to a string, right-to-left. */
const applyEdits = (text: string, edits: Edit[]): string => {
  const sorted = [...edits].sort((a, b) => b.start - a.start);
  let out = text;
  for (const e of sorted) out = out.slice(0, e.start) + e.replacement + out.slice(e.end);
  return out;
};

/** Rewrite a TS source string: insert one-line JSDoc above functions that lack it. */
const rewriteTs = (project: Project, filePath: string, text: string): string | null => {
  const src = project.createSourceFile(filePath, text, { overwrite: true });
  const candidates = collect(src);
  if (candidates.length === 0) return null;
  const edits: Edit[] = [];
  for (const c of candidates) {
    const { lineStart, indent } = indentFor(text, c.start);
    const doc = describeFromName(c.name);
    edits.push({
      start: lineStart,
      end: lineStart,
      replacement: `${indent}/** ${doc} */\n`,
    });
  }
  return applyEdits(text, edits);
};

/** Process a single source file, returning true if it would change. */
const processFile = (project: Project, filePath: string): boolean => {
  const src = read(filePath);
  if (filePath.endsWith(".ts")) {
    const out = rewriteTs(project, filePath, src);
    if (out == null || out === src) return false;
    if (APPLY) write(filePath, out);
    return true;
  }
  const blocks = extractScripts(src);
  if (blocks.length === 0) return false;
  const newInners: string[] = [];
  let anyChanged = false;
  for (let i = 0; i < blocks.length; i++) {
    const virt = `${filePath}.__script${i}.ts`;
    const out = rewriteTs(project, virt, blocks[i].inner);
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
  const project = new Project({ useInMemoryFileSystem: true });
  const all = ROOTS.flatMap((r) => collectSources(r));
  const changed: string[] = [];
  for (const f of all) if (processFile(project, f)) changed.push(rel(f, ROOT));
  const mode = APPLY ? "APPLIED" : "DRY RUN";
  console.log(`[rule3 ${mode}] ${changed.length} file(s) changed`);
  for (const c of changed) console.log(`  ${c}`);
};

main();
