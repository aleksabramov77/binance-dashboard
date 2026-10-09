"use client";

import { Sparkles } from "lucide-react";
import { cn } from "@/shared/lib";
import { useAiCredits } from "../api/useAiCredits";

/** Порог «пора пополнить», $ — примерно 2 500 разборов Haiku. */
const LOW_BALANCE_USD = 1;

const usd = (v: number) =>
  `$${v.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Остаток на счёте OpenRouter (ИИ-разборы). Не показывается, если ключ не настроен. */
export function AiCreditsBadge() {
  const { data, error } = useAiCredits();
  if (error)
    return (
      <span
        className="text-xs text-muted-foreground"
        title={`Баланс OpenRouter: ${error.message}`}
      >
        ИИ: —
      </span>
    );
  if (!data?.configured) return null;

  const low = data.balanceUsd < LOW_BALANCE_USD;
  const title = [
    `Счёт OpenRouter: пополнено ${usd(data.totalCreditsUsd)}, потрачено ${usd(data.totalUsageUsd)}`,
    data.keyLimitUsd !== null && data.keyRemainingUsd !== null
      ? `Лимит ключа дашборда: осталось ${usd(data.keyRemainingUsd)} из ${usd(data.keyLimitUsd)}`
      : "У ключа нет лимита трат",
    `Этим ключом потрачено: ${usd(data.keyUsageUsd)}`,
  ].join("\n");

  return (
    <a
      href="https://openrouter.ai/settings/credits"
      target="_blank"
      rel="noreferrer"
      title={title}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-xs tabular-nums transition-colors hover:bg-secondary",
        low
          ? "border-destructive/60 text-destructive"
          : "text-muted-foreground",
      )}
    >
      <Sparkles className="size-3.5" />
      ИИ {usd(data.balanceUsd)}
    </a>
  );
}
