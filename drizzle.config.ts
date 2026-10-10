import { defineConfig } from "drizzle-kit";

// Генерация миграций: `pnpm db:generate` (БД не нужна). Применение — `pnpm db:migrate`
// или автоматически при старте сервера (instrumentation.ts).
export default defineConfig({
  dialect: "postgresql",
  // Таблицы — в слайсах своих доменов (docs/ai/architecture.md → «Домены и изоляция»).
  schema: "./src/entities/*/model/db.ts",
  out: "./drizzle",
});
