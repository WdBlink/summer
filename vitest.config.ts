import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@summer/protocol": fromRoot("./packages/protocol/src/index.ts"),
      "@summer/components": fromRoot("./packages/components/src/index.ts"),
      "@summer/compiler": fromRoot("./packages/compiler/src/index.ts"),
      "@summer/core": fromRoot("./packages/core/src/index.ts"),
      "@summer/runtime-mastra": fromRoot("./packages/runtime-mastra/src/index.ts"),
      "@summer/research-ideation": fromRoot(
        "./packages/research-ideation/src/index.ts"
      ),
      "@summer/cli": fromRoot("./packages/cli/src/index.ts")
    }
  },
  test: {
    include: ["packages/**/*.test.ts", "tests/**/*.test.ts"],
    coverage: {
      reporter: ["text", "json-summary"]
    }
  }
});
