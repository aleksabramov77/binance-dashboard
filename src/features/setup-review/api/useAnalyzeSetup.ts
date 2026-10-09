"use client";

import { useMutation } from "@tanstack/react-query";
import {
  type Setup,
  type SetupAnalysisResult,
  setupAnalysisResultSchema,
} from "@/entities/market-signal";

export class AnalysisRequestError extends Error {
  constructor(
    message: string,
    readonly notConfigured: boolean,
  ) {
    super(message);
  }
}

async function postAnalysis(setup: Setup): Promise<SetupAnalysisResult> {
  const res = await fetch("/api/analysis", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(setup),
  });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = body as { error?: string; notConfigured?: boolean } | null;
    throw new AnalysisRequestError(
      err?.error ?? `Разбор не получен (${res.status})`,
      Boolean(err?.notConfigured),
    );
  }
  return setupAnalysisResultSchema.parse(body);
}

export function useAnalyzeSetup() {
  return useMutation({ mutationFn: postAnalysis });
}
