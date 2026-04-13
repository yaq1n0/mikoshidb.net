import { Project, SyntaxKind, FunctionDeclaration, Node } from "ts-morph";
import { collectSources, rel } from "./lib/files.js";
import { extractScripts, read, replaceScripts, write } from "./lib/vue.js";

const ROOT = new URL("../..", import.meta.url).pathname;
const ROOTS = [`${ROOT}/src`, `${ROOT}/packages/opensona/src`];

const APPLY = process.argv.includes("--apply");

type Edit = { start: number; end: number; replacement: string };
type SkipReason =
  | "generator"
  | "overload"
  | "anonymous"
  | "default-export"
  | "composable"
  | "this-usage"
  | "arguments-usage"
  | "hoisted"
  | "nested";

type Skipped = { file: string; name: string; reason: SkipReason };

/** True if the fn body references `this` (excluding nested function/class scopes). */
const usesThis = (fn: FunctionDeclaration): boolean => {
  const body = fn.getBody();
  if (!body) return false;
  let found = false;
  body.forEachDescendant((n, traversal) => {
    if (found) {
      traversal.stop();
      return;
    }
    const kind = n.getKind();
    if (
      kind === SyntaxKind.FunctionDeclaration ||
      kind === SyntaxKind.FunctionExpression ||
      kind === SyntaxKind.ClassDeclaration ||
      kind === SyntaxKind.ClassExpression ||
      kind === SyntaxKind.MethodDeclaration
    ) {
      traversal.skip();
      return;
    }
    if (kind === SyntaxKind.ThisKeyword) {
      found = true;
      traversal.stop();
    }
  });
  return found;
};

/** True if the fn body references `arguments` (excluding nested function scopes). */
const usesArguments = (fn: FunctionDeclaration): boolean => {
  const body = fn.getBody();
  if (!body) return false;
  let found = false;
  body.forEachDescendant((n, traversal) => {
    if (found) {
      traversal.stop();
      return;
    }
    const kind = n.getKind();
    if (
      kind === SyntaxKind.FunctionDeclaration ||
      kind === SyntaxKind.FunctionExpression
    ) {
      traversal.skip();
      return;
    }
    if (Node.isIdentifier(n) && n.getText() === "arguments") {
      found = true;
      traversal.stop();
    }
  });
  return found;
};

/** True if another declaration with the same name exists in the same parent scope (overloads). */
const hasOverloads = (fn: FunctionDeclaration): boolean => {
  const name = fn.getName();
  if (!name) return false;
  const parent = fn.getParent();
  if (!parent) return false;
  const siblings = parent
    .getChildrenOfKind(SyntaxKind.FunctionDeclaration)
    .filter((f) => f.getName() === name);
  return siblings.length > 1;
};

/** True if an identifier sits in a declaration-name / property-name position, not a value reference. */
const isNonReferencePosition = (id: Node): boolean => {
  const parent = id.getParent();
  if (!parent) return false;
  const k = parent.getKind();
  const nameBearingKinds: Array<SyntaxKind> = [
    SyntaxKind.PropertyAssignment,
    SyntaxKind.ShorthandPropertyAssignment,
    SyntaxKind.PropertySignature,
    SyntaxKind.PropertyDeclaration,
    SyntaxKind.MethodSignature,
    SyntaxKind.MethodDeclaration,
    SyntaxKind.GetAccessor,
    SyntaxKind.SetAccessor,
    SyntaxKind.EnumMember,
    SyntaxKind.ImportSpecifier,
    SyntaxKind.ExportSpecifier,
    SyntaxKind.NamespaceImport,
    SyntaxKind.ImportClause,
    SyntaxKind.BindingElement,
    SyntaxKind.VariableDeclaration,
    SyntaxKind.Parameter,
    SyntaxKind.TypeParameter,
    SyntaxKind.TypeAliasDeclaration,
    SyntaxKind.InterfaceDeclaration,
    SyntaxKind.ClassDeclaration,
    SyntaxKind.FunctionDeclaration,
    SyntaxKind.JsxAttribute,
    SyntaxKind.LabeledStatement,
  ];
  if (nameBearingKinds.includes(k)) {
    const named = parent as unknown as { getNameNode?: () => Node | undefined };
    if (typeof named.getNameNode === "function" && named.getNameNode() === id) return true;
  }
  if (k === SyntaxKind.PropertyAccessExpression) {
    const pa = parent as unknown as { getNameNode: () => Node };
    if (pa.getNameNode() === id) return true;
  }
  if (k === SyntaxKind.QualifiedName) {
    const qn = parent as unknown as { getRight: () => Node };
    if (qn.getRight() === id) return true;
  }
  return false;
};

/** True if the function name is lexically referenced (as a value) earlier than its declaration. */
const isHoistedUse = (fn: FunctionDeclaration): boolean => {
  const name = fn.getName();
  if (!name) return false;
  const declStart = fn.getStart();
  const src = fn.getSourceFile();
  const refs = src
    .getDescendantsOfKind(SyntaxKind.Identifier)
    .filter((id) => id.getText() === name);
  for (const r of refs) {
    if (r.getStart() >= declStart) continue;
    if (isNonReferencePosition(r)) continue;
    return true;
  }
  return false;
};

/** True if the FunctionDeclaration is a top-level module declaration (parent is SourceFile). */
const isModuleScope = (fn: FunctionDeclaration): boolean => {
  const parent = fn.getParent();
  return parent?.getKind() === SyntaxKind.SourceFile;
};

/** Decide if a FunctionDeclaration should be skipped; returns the reason when skipped. */
const skipReason = (fn: FunctionDeclaration): SkipReason | null => {
  if (fn.isGenerator()) return "generator";
  const name = fn.getName();
  if (!name) return "anonymous";
  const isDefault = fn.hasModifier(SyntaxKind.DefaultKeyword);
  if (isDefault) return "default-export";
  if (name.length >= 4 && name.startsWith("use") && name[3] === name[3].toUpperCase()) {
    return "composable";
  }
  if (!isModuleScope(fn)) return "nested";
  if (hasOverloads(fn)) return "overload";
  if (usesThis(fn)) return "this-usage";
  if (usesArguments(fn)) return "arguments-usage";
  if (isHoistedUse(fn)) return "hoisted";
  return null;
};

/** Build the edit set that rewrites a module-level function declaration into a const arrow. */
const planEdits = (fn: FunctionDeclaration): Edit[] | null => {
  const functionKw = fn.getFirstChildByKind(SyntaxKind.FunctionKeyword);
  const nameNode = fn.getNameNode();
  const body = fn.getBody();
  if (!functionKw || !nameNode || !body) return null;

  const isAsync = fn.hasModifier(SyntaxKind.AsyncKeyword);
  const asyncKw = isAsync ? fn.getFirstModifierByKind(SyntaxKind.AsyncKeyword) : undefined;

  const edits: Edit[] = [];

  if (asyncKw) {
    edits.push({ start: asyncKw.getStart(), end: functionKw.getStart(), replacement: "" });
  }

  edits.push({
    start: functionKw.getStart(),
    end: nameNode.getStart(),
    replacement: "const ",
  });

  const afterName = ` = ${isAsync ? "async " : ""}`;
  edits.push({ start: nameNode.getEnd(), end: nameNode.getEnd(), replacement: afterName });

  edits.push({ start: body.getStart(), end: body.getStart(), replacement: "=> " });
  edits.push({ start: body.getEnd(), end: body.getEnd(), replacement: ";" });

  return edits;
};

/** Apply non-overlapping edits to a string, right-to-left. */
const applyEdits = (text: string, edits: Edit[]): string => {
  const sorted = [...edits].sort((a, b) => b.start - a.start);
  let out = text;
  for (const e of sorted) {
    out = out.slice(0, e.start) + e.replacement + out.slice(e.end);
  }
  return out;
};

/** Rewrite a TS source text. Collects skipped candidates for reporting. */
const rewriteTs = (
  project: Project,
  filePath: string,
  text: string,
  skipped: Skipped[],
  relFile: string,
): string | null => {
  const src = project.createSourceFile(filePath, text, { overwrite: true });
  const fns = src.getDescendantsOfKind(SyntaxKind.FunctionDeclaration);
  const edits: Edit[] = [];
  for (const fn of fns) {
    const reason = skipReason(fn);
    if (reason) {
      if (reason !== "nested") {
        skipped.push({ file: relFile, name: fn.getName() ?? "<anon>", reason });
      }
      continue;
    }
    const e = planEdits(fn);
    if (e) edits.push(...e);
  }
  if (edits.length === 0) return null;
  return applyEdits(text, edits);
};

/** Process one source file. Returns true if a change was produced. */
const processFile = (project: Project, filePath: string, skipped: Skipped[]): boolean => {
  const relFile = rel(filePath, ROOT);
  const src = read(filePath);
  if (filePath.endsWith(".ts")) {
    const out = rewriteTs(project, filePath, src, skipped, relFile);
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
    const out = rewriteTs(project, virt, blocks[i].inner, skipped, relFile);
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
  const skipped: Skipped[] = [];
  for (const f of all) {
    if (processFile(project, f, skipped)) changed.push(rel(f, ROOT));
  }
  const mode = APPLY ? "APPLIED" : "DRY RUN";
  console.log(`[rule2 ${mode}] ${changed.length} file(s) changed`);
  for (const c of changed) console.log(`  ${c}`);
  if (skipped.length > 0) {
    console.log(`\nSkipped ${skipped.length} site(s):`);
    for (const s of skipped) console.log(`  ${s.file} :: ${s.name} (${s.reason})`);
  }
};

main();
