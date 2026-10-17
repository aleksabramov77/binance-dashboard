// `pnpm db:migrate` — применить миграции к базе SQLite (DATABASE_PATH, по умолчанию data/app.db; spec 0059).
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
