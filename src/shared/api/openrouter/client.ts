import { z } from "zod";
import type { LlmConfig } from "@/shared/config/env.server";

const API_URL = "https://openrouter.ai/api/v1/chat/completions";

const completionSchema = z.object({
  model: z.string(),
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string().nullable() }),
        finish_reason: z.string().nullable().optional(),
      }),
    )
    .min(1),
  usage: z.object({ cost: z.number().optional() }).loose().optional(),
});

const errorSchema = z.object({
  error: z.object({ message: z.string(), code: z.unknown().optional() }),
});

export class OpenRouterError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface JsonCompletion<T> {
  data: T;
  model: string;
  costUsd: number | null;
}

interface JsonRequest<T extends z.ZodType> {
  system: string;
  user: string;
  /** Имя и JSON Schema ответа (strict). */
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  /** Zod-схема той же формы — финальная проверка ответа. */
  schema: T;
  maxTokens?: number;
}

async function post(config: LlmConfig, body: Record<string, unknown>) {
  const send = () =>
    fetch(API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        "X-Title": "Binance Dashboard (personal)",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  // Один повтор при сетевом сбое (оборванное keep-alive соединение и т.п.).
  const res = await send().catch(send);
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const parsed = errorSchema.safeParse(json);
    throw new OpenRouterError(
      parsed.success
        ? `OpenRouter: ${parsed.data.error.message}`
        : `OpenRouter ответил ${res.status}`,
      res.status,
    );
  }
  return completionSchema.parse(json);
}

/** Один запрос к модели с ответом строго по JSON Schema. */
export async function completeJson<T extends z.ZodType>(
  config: LlmConfig,
  req: JsonRequest<T>,
): Promise<JsonCompletion<z.infer<T>>> {
  const body: Record<string, unknown> = {
    model: config.model,
    max_tokens: req.maxTokens ?? 4000,
    messages: [
      { role: "system", content: req.system },
      { role: "user", content: req.user },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: req.schemaName,
        strict: true,
        schema: req.jsonSchema,
      },
    },
    // Только провайдеры, которые умеют structured outputs.
    provider: { require_parameters: true },
    usage: { include: true },
  };

  let completion: z.infer<typeof completionSchema>;
  try {
    // Короткое рассуждение — дешевле, для разбора по цифрам достаточно.
    completion = await post(config, {
      ...body,
      reasoning: { effort: "low", exclude: true },
    });
  } catch (error) {
    // Если провайдер не принял параметры рассуждения — повторяем без них.
    if (!(error instanceof OpenRouterError && error.status === 400))
      throw error;
    completion = await post(config, body);
  }

  const content = completion.choices[0].message.content;
  if (!content) throw new Error("Модель вернула пустой ответ.");
  const data = req.schema.parse(JSON.parse(content));
  return {
    data,
    model: completion.model,
    costUsd: completion.usage?.cost ?? null,
  };
}
