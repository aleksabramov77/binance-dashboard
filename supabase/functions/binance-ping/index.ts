// Edge Function binance-ping (spec 007b, AC1): проверяет, пускает ли Binance запросы
// из региона, где запущена функция. Без ключей — только публичные ping-эндпоинты.
// Вызов: GET https://<ref>.supabase.co/functions/v1/binance-ping?forceFunctionRegion=ap-northeast-1
// с заголовком Authorization: Bearer <publishable/anon key> (проверка JWT включена).

const TIMEOUT_MS = 8000;

const TARGETS = {
  spot: "https://api.binance.com/api/v3/ping",
  futures: "https://fapi.binance.com/fapi/v1/ping",
} as const;

type PingResult = {
  /** HTTP-статус Binance; null — сеть/таймаут (см. error). */
  status: number | null;
  ms: number;
  error?: string;
};

async function ping(url: string): Promise<PingResult> {
  const started = performance.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    await res.body?.cancel();
    return { status: res.status, ms: Math.round(performance.now() - started) };
  } catch (err) {
    return {
      status: null,
      ms: Math.round(performance.now() - started),
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    };
  }
}

Deno.serve(async () => {
  const [spot, futures] = await Promise.all([
    ping(TARGETS.spot),
    ping(TARGETS.futures),
  ]);
  const body = {
    spot,
    futures,
    region: Deno.env.get("SB_REGION") ?? null,
    at: new Date().toISOString(),
  };
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
});
