"use client";

import { Sparkles } from "lucide-react";
import type { Setup, SetupAnalysis } from "@/entities/market-signal";
import { cn } from "@/shared/lib";
import { Button } from "@/shared/ui/Button";
import { AnalysisRequestError, useAnalyzeSetup } from "../api/useAnalyzeSetup";

const VERDICT: Record<
  SetupAnalysis["verdict"],
  { label: string; tone: string }
> = {
  take: { label: "Входить по плану", tone: "bg-positive/15 text-positive" },
  wait: { label: "Ждать подтверждения", tone: "bg-primary/20 text-foreground" },
  skip: { label: "Пропустить", tone: "bg-destructive/15 text-destructive" },
};

function List({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      <ul className="list-disc space-y-0.5 pl-4">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

export function SetupReview({ setup }: { setup: Setup }) {
  const review = useAnalyzeSetup();
  const result = review.data;

  if (!result) {
    return (
      <div className="space-y-2">
        <Button
          variant="ghost"
          title="Второе мнение ИИ по цифрам сетапа: вердикт, аргументы и условие отмены (~$0,0004)"
          className="w-full"
          onClick={() => review.mutate(setup)}
          disabled={review.isPending}
        >
          <Sparkles
            className={review.isPending ? "animate-pulse" : undefined}
          />
          {review.isPending ? "Модель думает…" : "Разбор от ИИ"}
        </Button>
        {review.error && (
          <p className="text-xs text-destructive">
            {review.error.message}
            {review.error instanceof AnalysisRequestError &&
              review.error.notConfigured &&
              " Ключ берётся на openrouter.ai → Keys, затем перезапустите сервер."}
          </p>
        )}
      </div>
    );
  }

  const { analysis } = result;
  const verdict = VERDICT[analysis.verdict];
  return (
    <div className="space-y-2 rounded-lg border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "rounded-md px-2 py-0.5 text-xs font-semibold",
            verdict.tone,
          )}
        >
          {verdict.label}
        </span>
        <span className="text-xs text-muted-foreground">
          уверенность {Math.round(analysis.confidence)}%
        </span>
      </div>
      <p>{analysis.summary}</p>
      <List title="За" items={analysis.pros} />
      <List title="Против" items={analysis.cons} />
      <div>
        <p className="text-xs font-medium text-muted-foreground">
          Идея ломается, если
        </p>
        <p>{analysis.invalidation}</p>
      </div>
      <p className="text-xs text-muted-foreground">
        {result.model}
        {result.costUsd !== null && ` · $${result.costUsd.toFixed(4)}`} · мнение
        модели, не финансовый совет
      </p>
    </div>
  );
}
