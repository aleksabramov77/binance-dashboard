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

/** Секрет для /api/cron/tick. null — не задан. */
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

/** Куда подключаться: Postgres по DATABASE_URL или встроенный PGlite (локально, без внешних сервисов). */
export function getDatabaseConfig(): DatabaseConfig {
  const env = dbEnvSchema.parse({
    DATABASE_URL: process.env.DATABASE_URL || undefined,
    PGLITE_DIR: process.env.PGLITE_DIR || undefined,
  });
  return env.DATABASE_URL
    ? { kind: "postgres", url: env.DATABASE_URL }
    : { kind: "pglite", dir: env.PGLITE_DIR };
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
