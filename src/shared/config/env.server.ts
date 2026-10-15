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
  /** Чат владельца: бот пишет лично (chat id из /start). null — ещё не известен. */
  chatId: string | null;
  /** Секрет webhook команд бота (заголовок X-Telegram-Bot-Api-Secret-Token). null — не задан. */
  webhookSecret: string | null;
}

/** Бот уведомлений и команд. null — токен не задан. */
export function getTelegramConfig(
  env: Record<string, string | undefined> = process.env,
): TelegramConfig | null {
  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) return null;
  return {
    token,
    chatId: env.TELEGRAM_CHAT_ID?.trim() || null,
    webhookSecret: env.TELEGRAM_WEBHOOK_SECRET?.trim() || null,
  };
}

/** Адрес дашборда в production: ссылки в уведомлениях, адрес webhook бота. */
export const getSiteUrl = (
  env: Record<string, string | undefined> = process.env,
): string =>
  (env.SITE_URL?.trim() || "https://binance-dashboard-gold.vercel.app").replace(
    /\/+$/,
    "",
  );

const DEFAULT_DB_SIZE_LIMIT_MB = 500;

export interface DbSizeLimitConfig {
  limitBytes: number;
  /** Значение DB_SIZE_LIMIT_MB, которое не распознано (тогда лимит по умолчанию); null — всё в порядке. */
  invalid: string | null;
}

/** Лимит размера базы для свободного места: DB_SIZE_LIMIT_MB, по умолчанию 500 МБ (Supabase Free). */
export function getDbSizeLimit(
  env: Record<string, string | undefined> = process.env,
): DbSizeLimitConfig {
  const raw = env.DB_SIZE_LIMIT_MB?.trim();
  const parsed = z.coerce
    .number()
    .positive()
    .finite()
    .safeParse(raw || DEFAULT_DB_SIZE_LIMIT_MB);
  return {
    limitBytes:
      (parsed.success ? parsed.data : DEFAULT_DB_SIZE_LIMIT_MB) * 1024 * 1024,
    invalid: parsed.success || !raw ? null : raw,
  };
}

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

/** Секрет для /api/cron/* (тик, снимок Earn, монитор логов). null — не задан. */
export const getCronSecret = (
  env: Record<string, string | undefined> = process.env,
): string | null => env.CRON_SECRET || null;

const dbEnvSchema = z.object({
  /** Postgres (прод — Supabase, строка подключения пулера). Пусто — локальный PGlite. */
  DATABASE_URL: z.url().optional(),
  /** Каталог файла PGlite, когда DATABASE_URL не задан. */
  PGLITE_DIR: z.string().min(1).default("data/pglite"),
});

export type DatabaseConfig =
  | { kind: "postgres"; url: string }
  | { kind: "pglite"; dir: string };

/**
 * Serverless-хостинг (Vercel выставляет VERCEL=1): процесс живёт только на время запроса,
 * файловая система только для чтения. Фоновых задач и локальных файлов там нет.
 */
export const isServerless = (
  env: Record<string, string | undefined> = process.env,
): boolean => env.VERCEL === "1";

/** Куда подключаться: Postgres по DATABASE_URL или встроенный PGlite (локально, без внешних сервисов). */
export function getDatabaseConfig(
  env: Record<string, string | undefined> = process.env,
): DatabaseConfig {
  const parsed = dbEnvSchema.parse({
    DATABASE_URL: env.DATABASE_URL || undefined,
    PGLITE_DIR: env.PGLITE_DIR || undefined,
  });
  if (parsed.DATABASE_URL)
    return { kind: "postgres", url: parsed.DATABASE_URL };
  // PGlite пишет файл на диск — на serverless писать некуда, а данные терялись бы между запросами.
  if (isServerless(env))
    throw new Error(
      "DATABASE_URL не задан: на serverless-хостинге нужен Postgres (Supabase, Transaction pooler).",
    );
  return { kind: "pglite", dir: parsed.PGLITE_DIR };
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
