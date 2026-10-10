// Edge Function engine-tick (spec 007b, AC2): один вызов — один тик движка лаборатории с ролью
// "supabase". Логика тика — общая с VM (src/app/server/engineTick.ts → features/paper-engine →
// trading-core), исходники подключаются через import map (deno.json). Здесь — только среда Deno:
// подключение к БД, транспорт Binance, проверка секрета вызова.
//
// Вызов (pg_cron + pg_net раз в минуту, supabase/migrations/*_engine_tick_cron.sql):
//   POST https://<ref>.supabase.co/functions/v1/engine-tick?forceFunctionRegion=ap-northeast-1
//   Authorization: Bearer <ENGINE_TICK_SECRET>
// verify_jwt = false (supabase/config.toml): шлюз не проверяет JWT, секрет проверяет сама функция.
// ENGINE_TICK_SECRET — секрет функции (supabase secrets set) и тот же — в Vault (engine_tick_secret).

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  createPerpetualsSource,
  prepareEngineDb,
  runEngineTick,
} from "@/app/server/engineTick";
import type { ExperimentDb } from "@/entities/experiment";
import type { CandleCache } from "@/features/paper-engine";
import { createMarketApi, type GetJson } from "@/shared/api/binance/marketApi";

const BINANCE_TIMEOUT_MS = 10_000;
/** Повтор GET при сетевом сбое (не при ответе 4xx/5xx): пауза перед каждой следующей попыткой. */
const RETRY_DELAYS_MS = [500, 1500];
const PERPETUALS_TTL_MS = 60 * 60_000;

/** GET JSON публичного Binance: таймаут, повторы только при сетевой ошибке. */
const getJson: GetJson = async (url) => {
  let lastError: unknown;
  for (const delay of [0, ...RETRY_DELAYS_MS]) {
    if (delay) await new Promise((r) => setTimeout(r, delay));
    let res: Response;
    try {
      res = await fetch(url, {
        signal: AbortSignal.timeout(BINANCE_TIMEOUT_MS),
      });
    } catch (error) {
      lastError = error;
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new Error(
        `Binance: ответ ${res.status} (${new URL(url).pathname})`,
      );
    }
    return res.json();
  }
  throw new Error(
    `Binance: сеть не ответила — ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
};

const market = createMarketApi(getJson);

// Состояние экземпляра функции (живёт, пока Supabase держит воркер тёплым): подключение к БД,
// кэш свечей, справочник фьючерсов, признак сида каталога.
let client: ReturnType<typeof postgres> | null = null;
const cache: CandleCache = new Map();
const perpetuals = createPerpetualsSource(
  () => market.fetchPerpetualSymbols(),
  PERPETUALS_TTL_MS,
  Date.now,
);
let seeded = false;

function db(): ExperimentDb {
  const url = Deno.env.get("SUPABASE_DB_URL");
  if (!url) throw new Error("SUPABASE_DB_URL не задан");
  // prepare: false — пулер Supabase (transaction mode) не держит prepared statements.
  client ??= postgres(url, { max: 2, prepare: false, idle_timeout: 20 });
  return drizzle(client) as unknown as ExperimentDb;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

/** Сравнение секрета без утечки по времени: сравниваем SHA-256 обеих строк. */
async function sameSecret(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all(
    [a, b].map((s) => crypto.subtle.digest("SHA-256", enc.encode(s))),
  );
  const u = new Uint8Array(x);
  const v = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < u.length; i++) diff |= u[i] ^ v[i];
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Только POST" }, 405);
  const secret = Deno.env.get("ENGINE_TICK_SECRET");
  // Fail-closed: без секрета функцию не вызвать никому.
  if (!secret) return json({ error: "ENGINE_TICK_SECRET не задан" }, 503);
  const auth = req.headers.get("authorization") ?? "";
  if (!(await sameSecret(auth, `Bearer ${secret}`)))
    return json({ error: "Неверный секрет" }, 401);

  const started = Date.now();
  try {
    const result = await runEngineTick(
      {
        db: db(),
        runner: "supabase",
        market,
        perpetuals,
        cache,
        log: (level, event, message, data) =>
          console[level](JSON.stringify({ event, message, ...data })),
        // Сид каталога и первая эпоха — один раз на экземпляр и только для своего раннера.
        prepare: seeded ? undefined : prepareEngineDb,
      },
      started,
    );
    if (result.status === "ok" || result.status === "disabled") seeded = true;
    const ms = Date.now() - started;
    console.info(
      JSON.stringify({
        event: "engine.tick",
        status: result.status,
        opened: result.opened,
        closed: result.closed,
        evaluated: result.evaluated.length,
        errors: result.errors.length,
        ms,
      }),
    );
    return json({
      ...result,
      ms,
      region: Deno.env.get("SB_REGION") ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ event: "engine.tick.failed", message }));
    return json({ error: message }, 500);
  }
});
