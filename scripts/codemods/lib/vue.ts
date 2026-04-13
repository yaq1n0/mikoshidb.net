import { readFileSync, writeFileSync } from "node:fs";

export type VueScriptBlock = {
  fullMatch: string;
  openTag: string;
  closeTag: string;
  inner: string;
  startIndex: number;
  endIndex: number;
};

const SCRIPT_RE = /(<script\b[^>]*\blang=["']ts["'][^>]*>)([\s\S]*?)(<\/script>)/g;

/** Extract all `<script lang="ts">` blocks from a Vue SFC source. */
export const extractScripts = (src: string): VueScriptBlock[] => {
  const blocks: VueScriptBlock[] = [];
  let m: RegExpExecArray | null;
  SCRIPT_RE.lastIndex = 0;
  while ((m = SCRIPT_RE.exec(src))) {
    blocks.push({
      fullMatch: m[0],
      openTag: m[1],
      inner: m[2],
      closeTag: m[3],
      startIndex: m.index + m[1].length,
      endIndex: m.index + m[1].length + m[2].length,
    });
  }
  return blocks;
};

/** Replace script block inners in a Vue SFC source. Blocks must be in source order. */
export const replaceScripts = (
  src: string,
  blocks: VueScriptBlock[],
  newInners: string[],
): string => {
  let out = "";
  let cursor = 0;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    out += src.slice(cursor, b.startIndex);
    out += newInners[i];
    cursor = b.endIndex;
  }
  out += src.slice(cursor);
  return out;
};

/** Read a file's source. */
export const read = (p: string): string => readFileSync(p, "utf8");

/** Write a file's source. */
export const write = (p: string, s: string): void => writeFileSync(p, s, "utf8");
