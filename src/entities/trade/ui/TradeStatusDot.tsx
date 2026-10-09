import { cn } from "@/shared/lib";
import type { TradeStatus } from "../model/schema";
import { TRADE_STATUS_LABELS } from "../model/statusLabels";

/** Открытые — пустые круги, закрытые по ордеру — залитые круги, вручную — квадраты. */
const SHAPE: Record<TradeStatus, string> = {
  open: "rounded-full border-2 border-foreground",
  "open-trailing": "rounded-full border-2 border-positive",
  "open-unprotected": "rounded-full border-2 border-primary",
  tp: "rounded-full bg-positive",
  "stop-profit":
    "rounded-full bg-positive ring-2 ring-positive/50 ring-offset-1 ring-offset-card",
  sl: "rounded-full bg-destructive",
  "manual-profit": "rounded-[2px] bg-positive",
  "manual-loss": "rounded-[2px] bg-destructive",
  liquidation: "size-2.5 rotate-45 rounded-[1px] bg-destructive",
  unknown: "rounded-full border-2 border-dashed border-muted-foreground",
};

export function TradeStatusDot({
  status,
  title,
}: {
  status: TradeStatus;
  /** Подсказка; по умолчанию — подпись статуса. */
  title?: string;
}) {
  const label = title ?? TRADE_STATUS_LABELS[status];
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn("inline-block size-3 shrink-0", SHAPE[status])}
    />
  );
}
