import { defineConfig } from "drizzle-kit";

// Генерация миграций: `pnpm db:generate` (БД не нужна). Применение — `pnpm db:migrate`
// или автоматически при старте сервера (instrumentation.ts).
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/shared/db/schema.ts",
  out: "./drizzle",
});
