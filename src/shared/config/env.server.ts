import { z } from "zod";

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
