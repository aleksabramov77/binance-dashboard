// Монитор журнала в облаке (платформа): pg_cron в Supabase → POST /api/cron/log-monitor на Vercel.
//   pnpm monitor:supabase chat-id       — узнать chat id владельца (после Start у бота) и записать в .env.local
//   pnpm monitor:supabase cron-install  — Vault (log_monitor_url, monitor_cron_secret) + задание log-monitor
//   pnpm monitor:supabase cron-remove   — снять задание
//   pnpm monitor:supabase run           — прогон монитора сейчас (на Vercel)
//   pnpm monitor:supabase test          — тестовое сообщение в Telegram (через Vercel)
//   pnpm monitor:supabase status        — последние запуски задания
// Env: DATABASE_URL, TELEGRAM_BOT_TOKEN (.env.local), CRON_SECRET (~/.config/vercel/binance-dashboard-prod.env).
import {
  appendFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import postgres from "postgres";

const JOB = "log-monitor";
const CRON_SQL = path.join(
  "supabase",
  "migrations",
  "20261011090000_log_monitor_cron.sql",
);
const ENV_FILE = process.env.ENV_FILE ?? ".env.local";
const BASE =
  process.env.SITE_URL ?? "https://binance-dashboard-gold.vercel.app";
const url = () => `${BASE}/api/cron/log-monitor`;

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

async function chatId() {
  const token = need("TELEGRAM_BOT_TOKEN");
  const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
  const body = (await res.json()) as {
    result?: { message?: { chat?: { id: number; username?: string } } }[];
  };
  const chats = (body.result ?? []).flatMap((u) =>
    u.message?.chat ? [u.message.chat] : [],
  );
  const chat = chats.at(-1);
  if (!chat) {
    console.log(
      "Сообщений боту ещё нет: откройте бота в Telegram и нажмите Start, затем повторите.",
    );
    return;
  }
  const id = String(chat.id);
  const text = readFileSync(ENV_FILE, "utf8");
  if (/^TELEGRAM_CHAT_ID=/m.test(text))
    writeFileSync(
      ENV_FILE,
      text.replace(/^TELEGRAM_CHAT_ID=.*$/m, `TELEGRAM_CHAT_ID=${id}`),
    );
  else
    appendFileSync(
      ENV_FILE,
      `${text.endsWith("\n") ? "" : "\n"}TELEGRAM_CHAT_ID=${id}\n`,
    );
  console.log(
    `TELEGRAM_CHAT_ID=${id} (@${chat.username ?? "—"}) записан в ${ENV_FILE}`,
  );
}

async function cronInstall() {
  const sql = db();
  try {
    await upsertVault(
      sql,
      "log_monitor_url",
      url(),
      "Роут монитора журнала на Vercel",
    );
    await upsertVault(
      sql,
      "monitor_cron_secret",
      need("CRON_SECRET"),
      "CRON_SECRET Vercel для /api/cron/log-monitor",
    );
    await sql.unsafe(readFileSync(CRON_SQL, "utf8"));
    console.log(`pg_cron: задание ${JOB} установлено (*/15 * * * *)`);
  } finally {
    await sql.end();
  }
}

async function cronRemove() {
  const sql = db();
  try {
    const rows =
      await sql`select cron.unschedule(jobid) from cron.job where jobname = ${JOB}`;
    console.log(rows.length ? `Задание ${JOB} снято` : `Задания ${JOB} нет`);
  } finally {
    await sql.end();
  }
}

const call =
  (query = "") =>
  async () => {
    const res = await fetch(url() + query, {
      method: "POST",
      headers: { authorization: `Bearer ${need("CRON_SECRET")}` },
    });
    console.log(res.status, await res.text());
  };

async function status() {
  const sql = db();
  try {
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
  "chat-id": chatId,
  "cron-install": cronInstall,
  "cron-remove": cronRemove,
  run: call(),
  test: call("?test=1"),
  status,
};
const command = commands[process.argv[2] ?? ""];
if (!command) {
  console.error(`Команды: ${Object.keys(commands).join(", ")}`);
  process.exit(1);
}
command().catch((error) => {
  console.error(
    `[monitor:supabase] ${error instanceof Error ? error.message : error}`,
  );
  process.exit(1);
});
