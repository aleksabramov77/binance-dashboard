import {
  type Setup,
  type SetupAnalysisResult,
  setupAnalysisSchema,
} from "@/entities/market-signal";
import { completeJson } from "@/shared/api/openrouter";
import { getLlmConfig } from "@/shared/config/env.server";
import {
  ANALYSIS_JSON_SCHEMA,
  ANALYSIS_SYSTEM_PROMPT,
  buildAnalysisPrompt,
} from "../lib/buildPrompt";

const CACHE_TTL_MS = 15 * 60_000;
const cache = new Map<string, { at: number; result: SetupAnalysisResult }>();

export class AnalysisNotConfiguredError extends Error {
  constructor() {
    super("OpenRouter не настроен: добавьте OPENROUTER_API_KEY в .env.local.");
  }
}

/** Разбор сетапа моделью. Один и тот же сетап (те же уровни) не оплачивается дважды за 15 мин. */
export async function analyzeSetup(setup: Setup): Promise<SetupAnalysisResult> {
  const config = getLlmConfig();
  if (!config) throw new AnalysisNotConfiguredError();

  const key = `${config.model}|${setup.id}|${setup.entry}|${setup.stopLoss}|${setup.takeProfit1}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.result;

  const completion = await completeJson(config, {
    system: ANALYSIS_SYSTEM_PROMPT,
    user: buildAnalysisPrompt(setup),
    schemaName: "setup_analysis",
    jsonSchema: ANALYSIS_JSON_SCHEMA,
    schema: setupAnalysisSchema,
  });

  const result: SetupAnalysisResult = {
    setupId: setup.id,
    model: completion.model,
    createdAt: new Date().toISOString(),
    analysis: completion.data,
    costUsd: completion.costUsd,
  };
  cache.set(key, { at: Date.now(), result });
  return result;
}

export function isAnalysisConfigured(): boolean {
  return getLlmConfig() !== null;
}
