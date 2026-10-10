"use client";

import { RefreshCw } from "lucide-react";
import { Suspense } from "react";
import { useScan } from "@/entities/market-signal";
import { useTradeOverview } from "@/entities/trade";
import {
  RiskSettingsBar,
  useEffectiveRiskSettings,
} from "@/features/position-sizing";
import { formatDateTime } from "@/shared/lib";
import { Button } from "@/shared/ui/button";
import { MarketMovers } from "@/widgets/market-movers";
import { SetupCards } from "@/widgets/setup-cards";
import { SignalsHelp } from "@/widgets/signals-help";
import { TradeLog } from "@/widgets/trade-log";

function Signals() {
  const scan = useScan();
  const tradeOverview = useTradeOverview();
  const balances = tradeOverview.data?.balances;
  // Капитал «авто» — всё, что лежит в USDT на демо (Spot + Futures).
  const autoCapital = balances ? balances.spot + balances.futures : null;
  const settings = useEffectiveRiskSettings(autoCapital);
  const data = scan.data;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Сигналы</h1>
          <p className="text-sm text-muted-foreground">
            Лидеры роста и падения на Binance и сетапы с входом, стопом и
            целями.
            {data &&
              ` Скан ${formatDateTime(data.scannedAt)}, ликвидных рынков: ${data.universeSize}.`}
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => scan.refetch()}
          disabled={scan.isFetching}
        >
          <RefreshCw className={scan.isFetching ? "animate-spin" : undefined} />
          Пересканировать
        </Button>
      </header>

      <RiskSettingsBar autoCapital={autoCapital} />
      <SignalsHelp />

      {scan.isPending && (
        <p className="text-muted-foreground">Сканирую рынок…</p>
      )}
      {scan.error && <p className="text-destructive">{scan.error.message}</p>}

      {data && (
        <>
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">
              Сетапы{" "}
              <span className="font-normal text-muted-foreground">
                · {data.setups.length}
              </span>
            </h2>
            <SetupCards
              setups={data.setups}
              settings={settings}
              overview={tradeOverview.data}
            />
          </section>
          {tradeOverview.data && <TradeLog overview={tradeOverview.data} />}
          <MarketMovers gainers={data.gainers} losers={data.losers} />
          <p className="text-xs text-muted-foreground">
            Сетапы — гипотезы по простым правилам (сильное движение за 24 ч +
            экстремальный RSI + отрыв от EMA50), а не гарантия. Их точность ещё
            не проверена журналом. Шорт — только фьючерсы, плечо не выше 3x.
            Сделки идут только в Binance Demo Trading (виртуальные деньги). Это
            не финансовый совет.
          </p>
        </>
      )}
    </div>
  );
}

export function SignalsPage() {
  return (
    <Suspense>
      <Signals />
    </Suspense>
  );
}
