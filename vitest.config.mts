import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      include: ["lib/**/*.ts"],
      exclude: ["lib/db.ts"],
    },
  },
  resolve: {
    alias: { "@": import.meta.dirname },
  },
});
