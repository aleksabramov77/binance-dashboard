// `pnpm engine:supabase <команда>` — управление тиком движка в Supabase (spec 007b, AC3/AC4).
// Секреты берёт из .env.local (или файла ENV_FILE) и не печатает. Команды:
//   status                — раннер, тумблер, последний тик, задание pg_cron и его последние запуски (только чтение)
//   runner oracle|supabase — кто исполняет тики (engine_state.runner); ждёт конца текущего тика
//   secret                — ENGINE_TICK_SECRET: создать в .env.local, если нет, и записать в секреты функций Supabase
//   cron-install          — secret + Vault (engine_tick_url, engine_tick_secret) + supabase/migrations/*_engine_tick_cron.sql
//   cron-remove           — снять задание engine-tick-every-minute
//   invoke                — один ручной POST в engine-tick (Токио), печатает ответ
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { ENGINE_TICK_LOCK_KEY } from "@/entities/experiment";

const JOB = "engine-tick-every-minute";
const REGION = "ap-northeast-1";
const CRON_SQL = path.join(
  "supabase",
  "migrations",
  "20261010120000_engine_tick_cron.sql",
);
const RUNNERS = ["oracle", "supabase"] as const;

const envFile = process.env.ENV_FILE ?? ".env.local";
/**
 * Свой разбор env-файла вместо process.loadEnvFile: тот молча теряет переменные после строки без
 * «ИМЯ=». Берём только строки ИМЯ=значение; уже заданные в окружении переменные не перезаписываем.
 */
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
loadEnv(envFile);

function need(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} не задан (${envFile})`);
  return value;
}

const functionUrl = () =>
  `https://${need("SUPABASE_PROJECT_REF")}.supabase.co/functions/v1/engine-tick?forceFunctionRegion=${REGION}`;

const db = () =>
  postgres(need("DATABASE_URL"), {
    max: 1,
    prepare: false,
    onnotice: () => {},
  });

/** ENGINE_TICK_SECRET из env; нет — генерирует и дописывает в env-файл. */
function ensureSecret(): string {
  const existing = process.env.ENGINE_TICK_SECRET;
  if (existing) return existing;
  const secret = randomBytes(32).toString("hex");
  appendFileSync(
    envFile,
    `\n# Ключ вызова Edge Function engine-tick (spec 007b): секрет функции и Vault engine_tick_secret\nENGINE_TICK_SECRET=${secret}\n`,
  );
  process.env.ENGINE_TICK_SECRET = secret;
  console.log(`ENGINE_TICK_SECRET создан и записан в ${envFile}`);
  return secret;
}

/** Секрет функции через Management API Supabase (как `supabase secrets set`, но без секрета в argv). */
async function pushFunctionSecret(secret: string) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${need("SUPABASE_PROJECT_REF")}/secrets`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${need("SUPABASE_ACCESS_TOKEN")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([{ name: "ENGINE_TICK_SECRET", value: secret }]),
    },
  );
  if (!res.ok)
    throw new Error(
      `Supabase secrets: ответ ${res.status} ${await res.text()}`,
    );
  console.log("Секрет функций ENGINE_TICK_SECRET обновлён");
}

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

async function status() {
  const sql = db();
  try {
    const state = await sql<{ key: string; value: unknown }[]>`
      select key, value from engine_state where key in ('runner', 'enabled', 'last_tick')`;
    const get = (k: string) => state.find((s) => s.key === k)?.value;
    console.log({
      runner: get("runner") ?? "oracle (не задан)",
      enabled: get("enabled") ?? false,
      lastTick: get("last_tick") ?? null,
    });
    const [cron] = await sql<{ ok: boolean }[]>`
      select exists (select 1 from pg_extension where extname = 'pg_cron') as ok`;
    if (!cron.ok) return console.log("pg_cron не установлен");
    const jobs = await sql`
      select jobid, schedule, active from cron.job where jobname = ${JOB}`;
    console.log({ job: jobs[0] ?? null });
    if (jobs[0])
      console.log(
        await sql`
          select status, return_message, start_time from cron.job_run_details
          where jobid = ${jobs[0].jobid} order by start_time desc limit 5`,
      );
  } finally {
    await sql.end();
  }
}

async function setRunner(runner: string | undefined) {
  if (!RUNNERS.includes(runner as (typeof RUNNERS)[number]))
    throw new Error(`Укажите раннер: ${RUNNERS.join(" | ")}`);
  const sql = db();
  try {
    await sql.begin(async (tx) => {
      // Та же блокировка, что у тика: дожидаемся конца текущего тика любого раннера.
      await tx`select pg_advisory_xact_lock(${ENGINE_TICK_LOCK_KEY})`;
      await tx`
        insert into engine_state (key, value) values ('runner', to_jsonb(${runner as string}::text))
        on conflict (key) do update set value = excluded.value, updated_at = now()`;
    });
    console.log(`engine_state.runner = ${runner}`);
  } finally {
    await sql.end();
  }
}

async function cronInstall() {
  const secret = ensureSecret();
  await pushFunctionSecret(secret);
  const sql = db();
  try {
    await upsertVault(
      sql,
      "engine_tick_url",
      functionUrl(),
      "URL Edge Function engine-tick (Tokyo), spec 007b",
    );
    await upsertVault(
      sql,
      "engine_tick_secret",
      secret,
      "Bearer-ключ вызова engine-tick, spec 007b",
    );
    await sql.unsafe(readFileSync(CRON_SQL, "utf8"));
    console.log(`pg_cron: задание ${JOB} установлено (* * * * *)`);
  } finally {
    await sql.end();
  }
}

async function cronRemove() {
  const sql = db();
  try {
    const removed = await sql`
      select cron.unschedule(jobid) from cron.job where jobname = ${JOB}`;
    console.log(
      removed.length ? `pg_cron: ${JOB} снято` : `pg_cron: ${JOB} не найдено`,
    );
  } finally {
    await sql.end();
  }
}

async function invoke() {
  const res = await fetch(functionUrl(), {
    method: "POST",
    headers: { Authorization: `Bearer ${need("ENGINE_TICK_SECRET")}` },
  });
  console.log(
    res.status,
    `x-sb-edge-region: ${res.headers.get("x-sb-edge-region")}`,
  );
  console.log(await res.text());
}

const [command, arg] = process.argv.slice(2);
const commands: Record<string, () => Promise<void>> = {
  status,
  runner: () => setRunner(arg),
  secret: () => pushFunctionSecret(ensureSecret()),
  "cron-install": cronInstall,
  "cron-remove": cronRemove,
  invoke,
};

const run = command ? commands[command] : undefined;
if (!run) {
  console.error(
    `Команды: ${Object.keys(commands).join(", ")} (см. docs/ai/deploy-supabase.md)`,
  );
  process.exit(1);
}
run().catch((error) => {
  console.error(
    "[engine:supabase]",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
