import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "coverage",
  ".opensona",
  ".git",
]);

/** Recursively collect .ts and .vue files, skipping generated/output dirs. */
export const collectSources = (root: string): string[] => {
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (SKIP_DIRS.has(name)) continue;
      const full = join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walk(full);
      } else if (st.isFile()) {
        if (full.endsWith(".ts") || full.endsWith(".vue")) {
          out.push(full);
        }
      }
    }
  };
  walk(root);
  return out;
};

/** Short display path relative to the repo root. */
export const rel = (p: string, root: string): string => relative(root, p);
