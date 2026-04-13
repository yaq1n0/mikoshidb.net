// packages/opensona/src/config.ts
// Load and merge opensona config: config.default.json <- consumer overrides

import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { OpensonaConfigSchema, type OpensonaConfig } from "./types.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONFIG_PATH = join(__dirname, "..", "config.default.json");

/**
 * Deep-merge source into target. Arrays are replaced, not concatenated.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function deepMerge(target: any, source: any): any {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const val = source[key];
    if (
      val !== null &&
      typeof val === "object" &&
      !Array.isArray(val) &&
      typeof result[key] === "object" &&
      result[key] !== null &&
      !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(result[key], val);
    } else if (val !== undefined) {
      result[key] = val;
    }
  }
  return result;
}

/**
 * Load opensona config by merging config.default.json with an optional
 * consumer override file (e.g. .opensona/config.json or tools/rag/opensona.config.json).
 *
 * Defaults are validated immediately (strict). Overrides are deep-merged, then
 * the merged result is validated — this catches typos, unknown keys, and
 * invalid values in the override without needing a separate partial schema.
 */
export async function loadConfig(overridePath?: string): Promise<OpensonaConfig> {
  const defaultRaw = await readFile(DEFAULT_CONFIG_PATH, "utf-8");
  const defaults = OpensonaConfigSchema.parse(JSON.parse(defaultRaw));

  if (!overridePath) return defaults;

  const overrideRaw = await readFile(overridePath, "utf-8");
  const overrides = JSON.parse(overrideRaw);

  return OpensonaConfigSchema.parse(deepMerge(defaults, overrides));
}
