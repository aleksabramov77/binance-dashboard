import path from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  // .claude/worktrees — копии репозитория других веток, их тесты здесь не гоняем.
  test: {
    environment: "node",
    exclude: [...configDefaults.exclude, ".claude/**"],
  },
});
