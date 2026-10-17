import { z } from "zod";
import { parseAllowedLogins } from "@/shared/lib/auth/accessPolicy";

const binanceEnvSchema = z.object({
  BINANCE_API_KEY: z.string().min(1),
  BINANCE_API_SECRET: z.string().min(1),
});

export type BinanceCredentials = { apiKey: string; apiSecret: string };

/** Ключи из .env.local; null — если не настроены. Только для сервера. */
export function getBinanceCredentials(): BinanceCredentials | null {
  const parsed = binanceEnvSchema.safeParse(process.env);
  if (!parsed.success) return null;
  return {
    apiKey: parsed.data.BINANCE_API_KEY,
    apiSecret: parsed.data.BINANCE_API_SECRET,
  };
}

/**
 * Файл мастер-ключа для секретов в базе (spec 0065): 32 байта в base64, на VM — /etc/binance/master.key. null — не
 * задан: ввод ключа основного аккаунта на сайте недоступен, ключ из env работает как раньше.
 */
export const getSecretsKeyFile = (
  env: Record<string, string | undefined> = process.env,
): string | null => env.SECRETS_KEY_FILE?.trim() || null;

export const ACCOUNT_KEY_FIXTURES = [
  "read-only",
  "trading",
  "rejected",
] as const;
export type AccountKeyFixture = (typeof ACCOUNT_KEY_FIXTURES)[number];

/**
 * Заглушка Binance для проверки ключа основного аккаунта на локальном сервере (тестировщик, `pnpm wt serve`): права
 * не запрашиваются у биржи, а берутся готовые. Только на Mac и не в production — на VM и Vercel всегда null.
 */
export function getAccountKeyFixture(
  env: Record<string, string | undefined> = process.env,
): AccountKeyFixture | null {
  if (getAppHost(env) !== "local" || env.NODE_ENV === "production") return null;
  const value = env.ACCOUNT_KEY_FIXTURE?.trim();
  return ACCOUNT_KEY_FIXTURES.find((f) => f === value) ?? null;
}

const demoEnvSchema = z.object({
  BINANCE_DEMO_API_KEY: z.string().min(1),
  BINANCE_DEMO_API_SECRET: z.string().min(1),
  /** Серверный лимит объёма одной демо-сделки, USD. */
  DEMO_MAX_NOTIONAL_USD: z.coerce.number().positive().default(1000),
});

export interface DemoTradingConfig {
  credentials: BinanceCredentials;
  maxNotionalUsd: number;
}

/** Ключ Binance Demo Trading (demo.binance.com) — виртуальные деньги. null — если не настроен. */
export function getDemoTradingConfig(): DemoTradingConfig | null {
  const parsed = demoEnvSchema.safeParse(process.env);
  if (!parsed.success) return null;
  return {
    credentials: {
      apiKey: parsed.data.BINANCE_DEMO_API_KEY,
      apiSecret: parsed.data.BINANCE_DEMO_API_SECRET,
    },
    maxNotionalUsd: parsed.data.DEMO_MAX_NOTIONAL_USD,
  };
}

const liveTradeEnvSchema = z.object({
  BINANCE_TRADE_API_KEY: z.string().trim().min(1),
  BINANCE_TRADE_API_SECRET: z.string().trim().min(1),
});

/**
 * Торговый ключ реального счёта — другой формы, чем BinanceCredentials: его нельзя по ошибке передать в
 * read-only или демо-функции (типы не сойдутся). Принимают его только функции `shared/api/binance/live.server.ts`.
 */
export interface LiveCredentials {
  readonly live: BinanceCredentials;
}

/**
 * Торговый ключ субсчёта реального счёта (spec 0047). Задаётся только в env воркера на VM; у веб-приложения
 * его нет. null — не задан (воркер шлёт пульс «ключ не задан»).
 */
export function getLiveTradeCredentials(
  env: Record<string, string | undefined> = process.env,
): LiveCredentials | null {
  const parsed = liveTradeEnvSchema.safeParse(env);
  if (!parsed.success) return null;
  return {
    live: {
      apiKey: parsed.data.BINANCE_TRADE_API_KEY,
      apiSecret: parsed.data.BINANCE_TRADE_API_SECRET,
    },
  };
}

/** Секрет пульса воркера реального счёта (Bearer для POST /api/live/heartbeat). null — не задан. */
export const getLiveWorkerSecret = (
  env: Record<string, string | undefined> = process.env,
): string | null => env.LIVE_WORKER_SECRET?.trim() || null;

/** Адрес приложения для пульса воркера (LIVE_APP_URL) без «/» в конце. null — не задан. */
export const getLiveAppUrl = (
  env: Record<string, string | undefined> = process.env,
): string | null => env.LIVE_APP_URL?.trim().replace(/\/+$/, "") || null;

/** Через сколько без пульса воркер «молчит», по умолчанию 5 мин (spec 0047, AC5). */
export const DEFAULT_LIVE_SILENT_AFTER_MS = 5 * 60_000;

/**
 * Порог «воркер молчит»: LIVE_SILENT_AFTER_SEC (для локальной проверки — меньше), по умолчанию 5 мин.
 * Нераспознанное значение — порог по умолчанию.
 */
export function getLiveSilentAfterMs(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env.LIVE_SILENT_AFTER_SEC?.trim();
  if (!raw) return DEFAULT_LIVE_SILENT_AFTER_MS;
  const parsed = z.coerce.number().int().positive().safeParse(raw);
  return parsed.success ? parsed.data * 1000 : DEFAULT_LIVE_SILENT_AFTER_MS;
}

const llmEnvSchema = z.object({
  OPENROUTER_API_KEY: z.string().min(1),
  ANALYSIS_MODEL: z.string().min(1).default("anthropic/claude-haiku-5.5"),
});

export interface LlmConfig {
  apiKey: string;
  model: string;
}

/** OpenRouter для разбора сетапов. null — если ключ не настроен. */
export function getLlmConfig(): LlmConfig | null {
  const parsed = llmEnvSchema.safeParse(process.env);
  if (!parsed.success) return null;
  return {
    apiKey: parsed.data.OPENROUTER_API_KEY,
    model: parsed.data.ANALYSIS_MODEL,
  };
}

const authEnvSchema = z.object({
  AUTH_SECRET: z.string().min(1),
  AUTH_GITHUB_ID: z.string().min(1),
  AUTH_GITHUB_SECRET: z.string().min(1),
  AUTH_ALLOWED_GITHUB_LOGINS: z
    .string()
    .transform(parseAllowedLogins)
    .pipe(z.array(z.string()).min(1)),
});

export type AuthConfig =
  | { mode: "disabled" }
  | { mode: "misconfigured"; missing: string[] }
  | {
      mode: "enabled";
      secret: string;
      githubId: string;
      githubSecret: string;
      allowedLogins: string[];
    };

/**
 * Вход через GitHub. Без AUTH_SECRET вне production защита выключена (локальная разработка);
 * в production или при частичной настройке — misconfigured: приложение закрыто (fail-closed).
 */
export function getAuthConfig(
  env: Record<string, string | undefined> = process.env,
): AuthConfig {
  if (!env.AUTH_SECRET && env.NODE_ENV !== "production")
    return { mode: "disabled" };
  const parsed = authEnvSchema.safeParse(env);
  if (!parsed.success)
    return {
      mode: "misconfigured",
      missing: [...new Set(parsed.error.issues.map((i) => String(i.path[0])))],
    };
  return {
    mode: "enabled",
    secret: parsed.data.AUTH_SECRET,
    githubId: parsed.data.AUTH_GITHUB_ID,
    githubSecret: parsed.data.AUTH_GITHUB_SECRET,
    allowedLogins: parsed.data.AUTH_ALLOWED_GITHUB_LOGINS,
  };
}

export interface TelegramConfig {
  token: string;
  /**
   * Чат уведомлений: закрытая группа с темами (spec 0067, id отрицательный) или, как раньше, личный чат владельца
   * (chat id из /start). null — ещё не известен.
   */
  chatId: string | null;
  /**
   * Владелец — id пользователя Telegram (TELEGRAM_OWNER_ID): бот отвечает на его команды в личке и в группе. По
   * умолчанию — TELEGRAM_CHAT_ID, если это личный чат (положительный id). null — бот не отвечает никому.
   */
  ownerId: string | null;
  /** Секрет webhook команд бота (заголовок X-Telegram-Bot-Api-Secret-Token). null — не задан. */
  webhookSecret: string | null;
}

/** Личный чат: id пользователя — положительный (у групп и каналов — отрицательный). */
export const isPrivateChatId = (id: string | null): boolean =>
  id !== null && /^[1-9]\d*$/.test(id);

/** Бот уведомлений и команд. null — токен не задан. */
export function getTelegramConfig(
  env: Record<string, string | undefined> = process.env,
): TelegramConfig | null {
  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) return null;
  const chatId = env.TELEGRAM_CHAT_ID?.trim() || null;
  return {
    token,
    chatId,
    ownerId:
      env.TELEGRAM_OWNER_ID?.trim() ||
      (isPrivateChatId(chatId) ? chatId : null),
    webhookSecret: env.TELEGRAM_WEBHOOK_SECRET?.trim() || null,
  };
}

const topicIdSchema = z.coerce.number().int().positive();

/**
 * Номер темы группы (message_thread_id) из env-переменной name — у каждой категории уведомлений своя
 * (TELEGRAM_TOPIC_*, список — src/app/server/notify.ts). null — не задана или не целое > 0: сообщение без темы.
 */
export function getTelegramTopicId(
  name: string,
  env: Record<string, string | undefined> = process.env,
): number | null {
  const raw = env[name]?.trim();
  if (!raw) return null;
  const parsed = topicIdSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * Адрес дашборда в production (SITE_URL): ссылки в уведомлениях, адрес webhook бота. null — не задан: без запасного
 * адреса, чтобы ссылки не вели на старый хостинг (spec 0063).
 */
export const getSiteUrl = (
  env: Record<string, string | undefined> = process.env,
): string | null => env.SITE_URL?.trim().replace(/\/+$/, "") || null;

/** Ссылка на страницу дашборда (`/logs`, `/settings#live`); null — SITE_URL не задан. */
export const getSiteLink = (
  path: string,
  env: Record<string, string | undefined> = process.env,
): string | null => {
  const site = getSiteUrl(env);
  return site ? `${site}${path}` : null;
};

/** Модель для разбора сбоев монитором логов: дешёвая, отдельно от разбора сетапов. */
export const getLogAnalysisModel = (
  env: Record<string, string | undefined> = process.env,
): string => env.LOG_ANALYSIS_MODEL?.trim() || "anthropic/claude-haiku-5.5";

/**
 * Версия сборки сервера — та же, что deploymentId в next.config.ts: NEXT_DEPLOYMENT_ID (если задан),
 * иначе VERCEL_DEPLOYMENT_ID (id деплоя, задаёт Vercel). null — не задана (локально).
 */
export const getDeploymentVersion = (
  env: Record<string, string | undefined> = process.env,
): string | null =>
  env.NEXT_DEPLOYMENT_ID?.trim() || env.VERCEL_DEPLOYMENT_ID?.trim() || null;

const DEFAULT_GITHUB_ALERTS_REPO = "aleksabramov77/binance-dashboard-private";
const DEFAULT_ALERT_AUTOFIX_PER_DAY = 3;

export interface GithubAlertsConfig {
  token: string;
  owner: string;
  repo: string;
  /** Сколько задач за 24 ч запускают Claude; сверх — в очередь (spec 0037). */
  autofixPerDay: number;
  /** Имена переменных с нераспознанным значением (тогда — значение по умолчанию). */
  invalid: string[];
}

/**
 * Задачи по тревогам монитора в приватном репозитории (spec 0037). null — GITHUB_ALERTS_TOKEN не задан:
 * монитор работает как раньше, только Telegram.
 */
export function getGithubAlertsConfig(
  env: Record<string, string | undefined> = process.env,
): GithubAlertsConfig | null {
  const token = env.GITHUB_ALERTS_TOKEN?.trim();
  if (!token) return null;
  const invalid: string[] = [];

  const rawRepo = env.GITHUB_ALERTS_REPO?.trim();
  const repoOk = !rawRepo || /^[\w.-]+\/[\w.-]+$/.test(rawRepo);
  if (!repoOk) invalid.push("GITHUB_ALERTS_REPO");
  const [owner, repo] = (
    rawRepo && repoOk ? rawRepo : DEFAULT_GITHUB_ALERTS_REPO
  ).split("/");

  const rawPerDay = env.ALERT_AUTOFIX_PER_DAY?.trim();
  const perDay = z.coerce
    .number()
    .int()
    .min(0)
    .safeParse(rawPerDay || DEFAULT_ALERT_AUTOFIX_PER_DAY);
  if (!perDay.success) invalid.push("ALERT_AUTOFIX_PER_DAY");

  return {
    token,
    owner,
    repo,
    autofixPerDay: perDay.success ? perDay.data : DEFAULT_ALERT_AUTOFIX_PER_DAY,
    invalid,
  };
}

/** Секрет для /api/cron/* (тик, снимок Earn, монитор логов). null — не задан. */
export const getCronSecret = (
  env: Record<string, string | undefined> = process.env,
): string | null => env.CRON_SECRET || null;

/** База приложения — файл SQLite (spec 0059): путь из DATABASE_PATH; `:memory:` — в памяти (тесты). */
export interface DatabaseConfig {
  kind: "sqlite";
  path: string;
}

/** Файл базы по умолчанию — локально, относительно папки проекта (на VM DATABASE_PATH задаёт app.env). */
export const DEFAULT_DATABASE_PATH = "data/app.db";

/**
 * Serverless-хостинг (Vercel выставляет VERCEL=1): процесс живёт только на время запроса,
 * файловая система только для чтения. Фоновых задач и локальных файлов там нет.
 */
export const isServerless = (
  env: Record<string, string | undefined> = process.env,
): boolean => env.VERCEL === "1";

/** Где работает процесс: Vercel, своя VM (APP_HOST=vm в /etc/<проект>/app.env, spec 0017) или Mac. */
export type AppHost = "vercel" | "vm" | "local";

export const getAppHost = (
  env: Record<string, string | undefined> = process.env,
): AppHost =>
  isServerless(env) ? "vercel" : env.APP_HOST?.trim() === "vm" ? "vm" : "local";

/** Файл SQLite приложения: DATABASE_PATH или data/app.db. DATABASE_URL (Supabase) приложение больше не читает. */
export function getDatabaseConfig(
  env: Record<string, string | undefined> = process.env,
): DatabaseConfig {
  // Файл базы на serverless писать некуда, а данные терялись бы между запросами.
  if (isServerless(env))
    throw new Error(
      "База приложения — файл SQLite (spec 0059): на serverless-хостинге (Vercel) приложение не работает, только на VM.",
    );
  const path = env.DATABASE_PATH?.trim();
  // На VM каталог кода только для чтения (ProtectSystem=strict) и перезаписывается выкаткой (rsync --delete):
  // база по умолчанию data/app.db там не сохранилась бы — путь обязателен.
  if (!path && getAppHost(env) === "vm")
    throw new Error(
      "DATABASE_PATH не задан: на VM база — /var/lib/binance/app.db, путь задаётся в /etc/binance/app.env.",
    );
  return { kind: "sqlite", path: path || DEFAULT_DATABASE_PATH };
}

const RUNNER_ROLES = ["oracle", "supabase"] as const;
export type RunnerRole = (typeof RUNNER_ROLES)[number];

export interface RunnerRoleConfig {
  role: RunnerRole;
  /** Значение ENGINE_RUNNER, которое не распознано (тогда role = oracle); null — всё в порядке. */
  invalid: string | null;
}

/**
 * Роль этого процесса как тик-раннера фонового движка: oracle (VM, по умолчанию) или supabase.
 * Тик работает, только если роль совпадает с выбранной в состоянии движка (spec 007b).
 */
export function getRunnerRole(
  env: Record<string, string | undefined> = process.env,
): RunnerRoleConfig {
  const raw = env.ENGINE_RUNNER?.trim();
  if (!raw) return { role: "oracle", invalid: null };
  const parsed = z.enum(RUNNER_ROLES).safeParse(raw);
  return parsed.success
    ? { role: parsed.data, invalid: null }
    : { role: "oracle", invalid: raw };
}
