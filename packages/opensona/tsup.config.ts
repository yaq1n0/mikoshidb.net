import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    "cli/index": "src/cli/index.ts",
    "runtime/index": "src/runtime/index.ts",
  },
  format: ["esm"],
  target: "node22",
  outDir: "dist",
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: false,
  shims: false,
  treeshake: true,
});
