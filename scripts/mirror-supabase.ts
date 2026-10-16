// Demo-зеркало в облаке (spec 008): pg_cron в Supabase → POST /api/cron/demo-mirror на Vercel.
//   pnpm mirror:supabase cron-install  — Vault (demo_mirror_url, monitor_cron_secret) + задание demo-mirror
//   pnpm mirror:supabase cron-remove   — снять задание (зеркало перестанет открывать и закрывать позиции)
//   pnpm mirror:supabase run           — прогон зеркала сейчас (на Vercel)
//   pnpm mirror:supabase status        — последние запуски задания
// Авто-зеркало (spec 0043): pg_cron раз в сутки (07:00 UTC) → POST /api/cron/mirror-auto.
//   pnpm mirror:supabase cron-install-auto — Vault (mirror_auto_url, monitor_cron_secret) + задание mirror-auto
//   pnpm mirror:supabase cron-remove-auto  — снять задание (автомат перестанет включать и выключать зеркала)
//   pnpm mirror:supabase auto [--dry-run]  — проверка авто-зеркала сейчас (на Vercel); --dry-run — только план
// Env: DATABASE_URL (.env.local), CRON_SECRET (~/.config/vercel/binance-dashboard-prod.env).
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import postgres from "postgres";

const JOB = "demo-mirror";
const CRON_SQL = path.join(
  "supabase",
  "migrations",
  "20261011120000_demo_mirror_cron.sql",
);
const BASE =
  process.env.SITE_URL ?? "https://binance-dashboard-gold.vercel.app";
const url = () => `${BASE}/api/cron/demo-mirror`;
const AUTO_JOB = "mirror-auto";
const AUTO_CRON_SQL = path.join(
  "supabase",
  "migrations",
  "20261016120000_mirror_auto_cron.sql",
);
const autoUrl = () => `${BASE}/api/cron/mirror-auto`;

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
      "demo_mirror_url",
      url(),
      "Роут demo-зеркала на Vercel",
    );
    await upsertVault(
      sql,
      "monitor_cron_secret",
      need("CRON_SECRET"),
      "CRON_SECRET Vercel для /api/cron/*",
    );
    await sql.unsafe(readFileSync(CRON_SQL, "utf8"));
    console.log(`pg_cron: задание ${JOB} установлено (* * * * *)`);
  } finally {
    await sql.end();
  }
}

async function cronInstallAuto() {
  const sql = db();
  try {
    await upsertVault(
      sql,
      "mirror_auto_url",
      autoUrl(),
      "Роут авто-зеркала на Vercel",
    );
    await upsertVault(
      sql,
      "monitor_cron_secret",
      need("CRON_SECRET"),
      "CRON_SECRET Vercel для /api/cron/*",
    );
    await sql.unsafe(readFileSync(AUTO_CRON_SQL, "utf8"));
    console.log(`pg_cron: задание ${AUTO_JOB} установлено (0 7 * * *, UTC)`);
  } finally {
    await sql.end();
  }
}

async function unschedule(job: string) {
  const sql = db();
  try {
    const rows =
      await sql`select cron.unschedule(jobid) from cron.job where jobname = ${job}`;
    console.log(rows.length ? `Задание ${job} снято` : `Задания ${job} нет`);
  } finally {
    await sql.end();
  }
}

async function post(target: string) {
  const res = await fetch(target, {
    method: "POST",
    headers: { authorization: `Bearer ${need("CRON_SECRET")}` },
  });
  console.log(res.status, await res.text());
}

async function status() {
  const sql = db();
  try {
    const runs = await sql`
      select d.status, d.return_message, d.start_time
      from cron.job_run_details d join cron.job j using (jobid)
      where j.jobname = ${JOB} order by d.start_time desc limit 5`;
    console.log(runs.length ? runs : `Запусков ${JOB} ещё не было`);
    const mirrors = await sql`
      select status, count(*)::int as n from demo_mirror_orders group by status`;
    console.log("Зеркала по статусам:", mirrors);
  } finally {
    await sql.end();
  }
}

const commands: Record<string, () => Promise<void>> = {
  "cron-install": cronInstall,
  "cron-remove": () => unschedule(JOB),
  run: () => post(url()),
  status,
  "cron-install-auto": cronInstallAuto,
  "cron-remove-auto": () => unschedule(AUTO_JOB),
  auto: () =>
    post(
      process.argv.includes("--dry-run") ? `${autoUrl()}?dryRun=1` : autoUrl(),
    ),
};
const command = commands[process.argv[2] ?? ""];
if (!command) {
  console.error(`Команды: ${Object.keys(commands).join(", ")}`);
  process.exit(1);
}
command().catch((error) => {
  console.error(
    `[mirror:supabase] ${error instanceof Error ? error.message : error}`,
  );
  process.exit(1);
});
