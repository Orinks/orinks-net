import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    exclude: ["e2e/**", "node_modules/**"],
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  oxc: {
    jsx: {
      runtime: "automatic",
    },
  },
});
