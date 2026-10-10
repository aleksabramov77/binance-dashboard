// `pnpm db:migrate` — применить миграции к БД из .env.local (DATABASE_URL или локальный PGlite).
import { existsSync } from "node:fs";
import { closeDb, migrateDb } from "@/shared/db/client.server";

async function main() {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  await migrateDb();
  await closeDb();
}

main().catch((error) => {
  console.error("[db:migrate]", error);
  process.exit(1);
});
