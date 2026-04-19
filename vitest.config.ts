import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "app/api/**/*.test.ts"],
    clearMocks: true,
    restoreMocks: true,
    globals: false,
  },
});
