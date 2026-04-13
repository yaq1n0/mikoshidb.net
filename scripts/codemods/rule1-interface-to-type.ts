import { Project, SyntaxKind, InterfaceDeclaration } from "ts-morph";
import { collectSources, rel } from "./lib/files.js";
import { extractScripts, read, replaceScripts, write } from "./lib/vue.js";

const ROOT = new URL("../..", import.meta.url).pathname;
const ROOTS = [`${ROOT}/src`, `${ROOT}/packages/opensona/src`];

const APPLY = process.argv.includes("--apply");

type Edit = {
  start: number;
  end: number;
  replacement: string;
};

/** Compute edits to rewrite an interface declaration (without `extends`) as a type alias. */
const planInterfaceEdit = (iface: InterfaceDeclaration, text: string): Edit[] | null => {
  if (iface.getExtends().length > 0) return null;

  const keyword = iface.getFirstChildByKind(SyntaxKind.InterfaceKeyword);
  if (!keyword) return null;
  const body = iface.getFirstChildByKind(SyntaxKind.OpenBraceToken);
  if (!body) return null;

  const kwStart = keyword.getStart();
  const kwEnd = keyword.getEnd();
  const braceStart = body.getStart();

  const nameNode = iface.getNameNode();
  const nameEnd = nameNode.getEnd();

  const tpsNode = iface.getFirstChildByKind(SyntaxKind.LessThanToken);
  const nameBlockEnd = tpsNode
    ? (iface.getLastChildByKind(SyntaxKind.GreaterThanToken)?.getEnd() ?? nameEnd)
    : nameEnd;

  const afterNameToBrace = text.slice(nameBlockEnd, braceStart);
  const closeBrace = iface.getLastChildByKind(SyntaxKind.CloseBraceToken);
  if (!closeBrace) return null;
  const closeEnd = closeBrace.getEnd();

  return [
    { start: kwStart, end: kwEnd, replacement: "type" },
    {
      start: nameBlockEnd,
      end: braceStart,
      replacement: afterNameToBrace.length === 0 ? " = " : `${afterNameToBrace}= `,
    },
    { start: closeEnd, end: closeEnd, replacement: ";" },
  ];
};

/** Apply a set of non-overlapping edits to a string, right-to-left. */
const applyEdits = (text: string, edits: Edit[]): string => {
  const sorted = [...edits].sort((a, b) => b.start - a.start);
  let out = text;
  for (const e of sorted) {
    out = out.slice(0, e.start) + e.replacement + out.slice(e.end);
  }
  return out;
};

/** Rewrite TS source text by locating and rewriting each applicable interface. */
const rewriteTs = (project: Project, filePath: string, text: string): string | null => {
  const src = project.createSourceFile(filePath, text, { overwrite: true });
  const ifaces = src.getDescendantsOfKind(SyntaxKind.InterfaceDeclaration);
  const edits: Edit[] = [];
  for (const iface of ifaces) {
    const planned = planInterfaceEdit(iface, text);
    if (planned) edits.push(...planned);
  }
  if (edits.length === 0) return null;
  return applyEdits(text, edits);
};

/** Apply rule 1 to a single file. Returns true if changed. */
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
  for (const f of all) {
    if (processFile(project, f)) changed.push(rel(f, ROOT));
  }
  const mode = APPLY ? "APPLIED" : "DRY RUN";
  console.log(`[rule1 ${mode}] ${changed.length} file(s) changed`);
  for (const c of changed) console.log(`  ${c}`);
};

main();
