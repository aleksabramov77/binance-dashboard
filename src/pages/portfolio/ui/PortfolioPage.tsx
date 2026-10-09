"use client";

import { RefreshCw } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { useEarnOverview } from "@/entities/earn-offer";
import { usePortfolio } from "@/entities/holding";
import { buildPlan } from "@/features/portfolio-advice";
import { formatDateTime } from "@/shared/lib";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { HoldingsTable } from "@/widgets/holdings-table";
import { PortfolioSummary } from "@/widgets/portfolio-summary";
import { RebalancePlan } from "@/widgets/rebalance-plan";

function SetupInstructions() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Подключите аккаунт Binance (только чтение)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <ol className="list-decimal space-y-1.5 pl-5">
          <li>
            binance.com → профиль → <b>API Management</b> → <b>Create API</b> →{" "}
            <b>System generated</b>.
          </li>
          <li>
            Оставьте включённым только <b>Enable Reading</b>. Торговлю, вывод и
            переводы не включайте.
          </li>
          <li>
            В корне проекта создайте файл <code>.env.local</code> по образцу{" "}
            <code>.env.example</code>:
            <pre className="mt-2 rounded-md bg-muted p-3 font-mono text-xs">
              BINANCE_API_KEY=...{"\n"}BINANCE_API_SECRET=...
            </pre>
          </li>
          <li>Перезапустите dev-сервер и обновите страницу.</li>
        </ol>
        <p className="text-muted-foreground">
          Ключ хранится только у вас на компьютере, в git не попадает и
          используется только сервером дашборда.
        </p>
      </CardContent>
    </Card>
  );
}

export function PortfolioPage() {
  const portfolio = usePortfolio();
  const earn = useEarnOverview();
  const data = portfolio.data;
  const offers = earn.data?.latest?.offers;

  const plans = useMemo(
    () =>
      data?.status === "ok" && offers ? buildPlan(data.holdings, offers) : [],
    [data, offers],
  );

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Портфель</h1>
          <p className="text-sm text-muted-foreground">
            Где сейчас лежат деньги и куда их выгоднее переложить.
            {data?.status === "ok" &&
              ` Балансы на ${formatDateTime(data.fetchedAt)}.`}
            {earn.data?.latest &&
              ` Ставки на ${formatDateTime(earn.data.latest.fetchedAt)}.`}
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => portfolio.refetch()}
          disabled={portfolio.isFetching}
        >
          <RefreshCw
            className={portfolio.isFetching ? "animate-spin" : undefined}
          />
          Обновить балансы
        </Button>
      </header>

      {portfolio.isPending && (
        <p className="text-muted-foreground">Загружаю балансы…</p>
      )}
      {portfolio.error && (
        <p className="text-destructive">{portfolio.error.message}</p>
      )}
      {data?.status === "not-configured" && <SetupInstructions />}
      {data?.status === "error" && (
        <p className="rounded-xl border border-destructive/50 p-4 text-sm text-destructive">
          {data.message}
        </p>
      )}

      {data?.status === "ok" && (
        <>
          <PortfolioSummary
            holdings={data.holdings}
            wallets={data.wallets}
            plans={plans}
          />
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Куда переложить</h2>
            {offers ? (
              <RebalancePlan plans={plans} />
            ) : (
              <p className="text-sm text-muted-foreground">
                Нет снимка ставок — откройте{" "}
                <Link href="/earn" className="underline">
                  Earn
                </Link>{" "}
                и нажмите «Обновить сейчас».
              </p>
            )}
          </section>
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Где лежат деньги</h2>
            <HoldingsTable holdings={data.holdings} />
          </section>
          <p className="text-xs text-muted-foreground">
            План учитывает Spot, Funding и Earn Flexible; Locked-позиции до
            окончания срока не трогаем. Обмен стейблкоинов может стоить
            небольшую комиссию/спред. Flexible-ставки плавающие, это не
            финансовый совет.
          </p>
        </>
      )}
    </div>
  );
}
