// Расписание снимков Earn в облаке (домен Earn): pg_cron в Supabase → POST /api/cron/earn-snapshot на Vercel.
//   pnpm earn:supabase cron-install  — Vault (earn_snapshot_url, earn_cron_secret) + задание earn-snapshot
//   pnpm earn:supabase cron-remove   — снять задание
//   pnpm earn:supabase collect       — снять снимок сейчас (вызов того же роута на Vercel)
//   pnpm earn:supabase status        — сколько снимков в БД и последние запуски задания
// Env: DATABASE_URL (.env.local), CRON_SECRET — секрет Vercel (по умолчанию из
// ~/.config/vercel/binance-dashboard-prod.env), EARN_SNAPSHOT_URL — адрес роута.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import postgres from "postgres";

const JOB = "earn-snapshot";
const CRON_SQL = path.join(
  "supabase",
  "migrations",
  "20261010170000_earn_snapshot_cron.sql",
);
const DEFAULT_URL =
  "https://binance-dashboard-gold.vercel.app/api/cron/earn-snapshot";

/** Строки ИМЯ=значение; уже заданные переменные не перезаписываем. Значения не печатаем. */
function loadEnv(file: string) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(
      line,
    );
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, "$2");
  }
}
loadEnv(process.env.ENV_FILE ?? ".env.local");
loadEnv(path.join(homedir(), ".config/vercel/binance-dashboard-prod.env"));

function need(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} не задан`);
  return value;
}
const url = () => process.env.EARN_SNAPSHOT_URL ?? DEFAULT_URL;
// В .env.local DATABASE_URL — пулер Supabase; prod-файл Vercel тоже его содержит — берём первый заданный.
const db = () =>
  postgres(need("DATABASE_URL"), {
    max: 1,
    prepare: false,
    onnotice: () => {},
  });

async function upsertVault(
  sql: postgres.Sql,
  name: string,
  value: string,
  description: string,
) {
  const [row] = await sql<{ id: string }[]>`
    select id from vault.secrets where name = ${name}`;
  if (row) await sql`select vault.update_secret(${row.id}::uuid, ${value})`;
  else await sql`select vault.create_secret(${value}, ${name}, ${description})`;
  console.log(`Vault: ${name} ${row ? "обновлён" : "создан"}`);
}

async function cronInstall() {
  const sql = db();
  try {
    await upsertVault(
      sql,
      "earn_snapshot_url",
      url(),
      "Роут снимка Earn на Vercel",
    );
    await upsertVault(
      sql,
      "earn_cron_secret",
      need("CRON_SECRET"),
      "CRON_SECRET Vercel для /api/cron/earn-snapshot",
    );
    await sql.unsafe(readFileSync(CRON_SQL, "utf8"));
    console.log(`pg_cron: задание ${JOB} установлено (0 3,15 * * * UTC)`);
  } finally {
    await sql.end();
  }
}

async function cronRemove() {
  const sql = db();
  try {
    const rows = await sql`
      select cron.unschedule(jobid) from cron.job where jobname = ${JOB}`;
    console.log(rows.length ? `Задание ${JOB} снято` : `Задания ${JOB} нет`);
  } finally {
    await sql.end();
  }
}

async function collect() {
  const res = await fetch(url(), {
    method: "POST",
    headers: { authorization: `Bearer ${need("CRON_SECRET")}` },
  });
  console.log(res.status, await res.text());
}

async function status() {
  const sql = db();
  try {
    const [n] = await sql<{ n: number; last: string | null }[]>`
      select count(*)::int as n, max(fetched_at)::text as last from earn_snapshots`;
    console.log("Снимков в БД:", n?.n, "последний:", n?.last);
    const runs = await sql`
      select d.status, d.return_message, d.start_time
      from cron.job_run_details d join cron.job j using (jobid)
      where j.jobname = ${JOB} order by d.start_time desc limit 5`;
    console.log(runs.length ? runs : `Запусков ${JOB} ещё не было`);
  } finally {
    await sql.end();
  }
}

const commands: Record<string, () => Promise<void>> = {
  "cron-install": cronInstall,
  "cron-remove": cronRemove,
  collect,
  status,
};
const command = commands[process.argv[2] ?? ""];
if (!command) {
  console.error(`Команды: ${Object.keys(commands).join(", ")}`);
  process.exit(1);
}
command().catch((error) => {
  console.error(
    `[earn:supabase] ${error instanceof Error ? error.message : error}`,
  );
  process.exit(1);
});
