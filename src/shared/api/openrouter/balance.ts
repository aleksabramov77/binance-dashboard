import { z } from "zod";
import type { LlmConfig } from "@/shared/config/env.server";
import { HttpError, withRetry } from "@/shared/lib/fetchRetry";

const BASE = "https://openrouter.ai/api/v1";

const creditsSchema = z.object({
  data: z.object({ total_credits: z.number(), total_usage: z.number() }),
});

const keySchema = z.object({
  data: z
    .object({
      limit: z.number().nullable(),
      limit_remaining: z.number().nullable(),
      usage: z.number(),
    })
    .loose(),
});

export interface OpenRouterBalance {
  /** Остаток на счёте OpenRouter, $ (пополнено − потрачено). */
  balanceUsd: number;
  totalCreditsUsd: number;
  totalUsageUsd: number;
  /** Лимит трат этого ключа и сколько от него осталось (null — без лимита). */
  keyLimitUsd: number | null;
  keyRemainingUsd: number | null;
  /** Потрачено этим ключом, $. */
  keyUsageUsd: number;
}

async function get<T extends z.ZodType>(
  config: LlmConfig,
  path: string,
  schema: T,
): Promise<z.infer<T>> {
  return withRetry(`OpenRouter ${path}`, async () => {
    const res = await fetch(`${BASE}${path}`, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
      cache: "no-store",
    });
    if (!res.ok)
      throw new HttpError(
        `OpenRouter ${path}: ответ ${res.status}`,
        res.status,
      );
    return schema.parse(await res.json());
  });
}

/** Баланс счёта OpenRouter и лимит ключа. */
export async function fetchOpenRouterBalance(
  config: LlmConfig,
): Promise<OpenRouterBalance> {
  const [credits, key] = await Promise.all([
    get(config, "/credits", creditsSchema),
    get(config, "/key", keySchema),
  ]);
  return {
    balanceUsd: credits.data.total_credits - credits.data.total_usage,
    totalCreditsUsd: credits.data.total_credits,
    totalUsageUsd: credits.data.total_usage,
    keyLimitUsd: key.data.limit,
    keyRemainingUsd: key.data.limit_remaining,
    keyUsageUsd: key.data.usage,
  };
}
