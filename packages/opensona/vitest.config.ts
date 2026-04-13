import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts"],
      // Exclude:
      // - test files themselves
      // - embed/verify (hit @huggingface/transformers — integration territory)
      // - runtime/loader + runtime/index + runtime/embedder (require a live
      //   bundle server + HF model; exercised by mikoshidb.net integration)
      exclude: [
        "src/**/*.test.ts",
        // HF-transformers boundary — integration territory
        "src/build/embed.ts",
        "src/runtime/embedder.ts",
      ],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 85,
        statements: 90,
      },
    },
  },
});
