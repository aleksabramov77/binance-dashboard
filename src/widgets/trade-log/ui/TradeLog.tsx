import type { TradeOverview, TradeResult } from "@/entities/trade";
import { cn, formatDateTime, formatPrice, formatUsd } from "@/shared/lib";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";

const STATUS: Record<TradeResult["status"], { label: string; tone: string }> = {
  protected: { label: "открыта, TP/SL стоят", tone: "text-positive" },
  unprotected: { label: "открыта без защиты", tone: "text-primary" },
  rejected: { label: "отклонена", tone: "text-destructive" },
};

export function TradeLog({ overview }: { overview: TradeOverview }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-baseline justify-between gap-2 text-base">
          <span>Демо-сделки</span>
          {overview.balances && (
            <span className="text-sm font-normal text-muted-foreground">
              Демо-баланс: Spot {formatUsd(overview.balances.spot)} · Futures{" "}
              {formatUsd(overview.balances.futures)}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!overview.configured ? (
          <p className="text-sm text-muted-foreground">
            Демо-торговля не подключена — нажмите «Сделка в 1 клик» на любом
            сетапе, там инструкция.
          </p>
        ) : overview.trades.length === 0 ? (
          <p className="text-sm text-muted-foreground">Сделок пока не было.</p>
        ) : (
          <ul className="divide-y text-sm">
            {overview.trades.map((t) => {
              const status = STATUS[t.status];
              const base = t.request.symbol.replace(/USDT$/, "");
              return (
                <li
                  key={t.id}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2"
                >
                  <span className="w-28 shrink-0 text-xs text-muted-foreground">
                    {formatDateTime(t.at)}
                  </span>
                  <span className="font-semibold">
                    {t.request.direction === "long" ? "LONG" : "SHORT"} {base}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t.request.market === "spot"
                      ? "Spot"
                      : `Futures ×${t.request.leverage}`}
                  </span>
                  {t.entryPrice !== null && (
                    <span className="font-mono text-xs">
                      вход {formatPrice(t.entryPrice)} · SL{" "}
                      {formatPrice(t.request.stopLoss)} · TP{" "}
                      {formatPrice(t.request.takeProfit)}
                    </span>
                  )}
                  <span className={cn("ml-auto text-xs", status.tone)}>
                    {status.label}
                  </span>
                  {t.status !== "protected" && (
                    <span className="w-full text-xs text-muted-foreground">
                      {t.message}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
