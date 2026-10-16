"use client";

import { RefreshCw, Zap } from "lucide-react";
import { useEffect, useId, useState } from "react";
import {
  type Setup,
  type SetupRecheck,
  useRecheck,
} from "@/entities/market-signal";
import {
  MAX_LEVERAGE,
  MAX_RISK_PCT,
  type TradeOverview,
  type TradeResult,
} from "@/entities/trade";
import { cn, formatUsd } from "@/shared/lib";
import { Badge } from "@/shared/ui/Badge";
import { Button } from "@/shared/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/ui/Dialog";
import { Input } from "@/shared/ui/Input";
import { usePlaceTrade } from "../api/usePlaceTrade";
import { rescaleQuantity } from "../lib/rescaleQuantity";

const RECHECK_VIEW: Record<
  SetupRecheck["status"],
  { title: string; tone: string }
> = {
  actual: {
    title: "Сетап актуален — уровни подтверждены",
    tone: "border-positive/40 bg-positive/10",
  },
  changed: {
    title: "Сетап актуален, но уровни обновлены по свежим данным",
    tone: "border-primary/50 bg-primary/10",
  },
  stale: {
    title: "Входить уже не стоит",
    tone: "border-destructive/50 bg-destructive/10",
  },
};

function RecheckBanner(props: {
  recheck: SetupRecheck | undefined;
  isPending: boolean;
  error: Error | null;
  onRetry: () => void;
}) {
  if (props.isPending) {
    return (
      <p className="rounded-lg border p-3 text-sm text-muted-foreground">
        Проверяю актуальность входа по свежим свечам и цене…
      </p>
    );
  }
  if (props.error) {
    return (
      <div className="rounded-lg border border-destructive/50 p-3 text-sm">
        <p className="text-destructive">
          Не удалось перепроверить сетап: {props.error.message}
        </p>
        <Button size="sm" variant="ghost" onClick={props.onRetry}>
          <RefreshCw /> Проверить ещё раз
        </Button>
      </div>
    );
  }
  if (!props.recheck) return null;
  const view = RECHECK_VIEW[props.recheck.status];
  const time = new Date(props.recheck.checkedAt).toLocaleTimeString("ru-RU");
  return (
    <div className={cn("space-y-1 rounded-lg border p-3 text-sm", view.tone)}>
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium">{view.title}</p>
        <Button size="sm" variant="ghost" onClick={props.onRetry}>
          <RefreshCw /> {time}
        </Button>
      </div>
      {props.recheck.notes.length > 0 && (
        <ul className="space-y-0.5 text-muted-foreground">
          {props.recheck.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface TradeTicketDialogProps {
  setup: Setup;
  /** Объём и плечо из калькулятора риска. */
  quantity: number;
  leverage: number;
  overview: TradeOverview | undefined;
}

function Field(props: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  step?: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {props.label}
      </label>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        step={props.step ?? "any"}
        disabled={props.disabled}
        className="font-mono"
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value) || 0)}
      />
    </div>
  );
}

function SetupInstructions() {
  return (
    <div className="space-y-3 text-sm">
      <p>Нужен API-ключ Binance Demo Trading (виртуальные деньги):</p>
      <ol className="list-decimal space-y-1 pl-5">
        <li>
          Откройте <b>demo.binance.com</b> → профиль → <b>API Management</b> →
          Create API.
        </li>
        <li>Включите чтение и торговлю (Spot и Futures). Вывод — не нужен.</li>
        <li>
          Добавьте в <code>.env.local</code>:
          <pre className="mt-2 rounded-md bg-muted p-3 font-mono text-xs">
            BINANCE_DEMO_API_KEY=...{"\n"}BINANCE_DEMO_API_SECRET=...
          </pre>
        </li>
        <li>Перезапустите dev-сервер.</li>
      </ol>
    </div>
  );
}

function ResultView({ result }: { result: TradeResult }) {
  const tone =
    result.status === "protected"
      ? "bg-positive/15 text-positive"
      : result.status === "unprotected"
        ? "bg-primary/20 text-foreground"
        : "bg-destructive/15 text-destructive";
  return (
    <div className="space-y-3 text-sm">
      <p className={cn("rounded-md px-3 py-2 font-medium", tone)}>
        {result.message}
      </p>
      {result.steps.length > 0 && (
        <ul className="space-y-1">
          {result.steps.map((s) => (
            <li key={s.label} className="flex gap-2">
              <span className={s.ok ? "text-positive" : "text-destructive"}>
                {s.ok ? "✓" : "✗"}
              </span>
              <span className="font-medium">{s.label}:</span>
              <span className="text-muted-foreground">{s.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function TradeTicketDialog({
  setup,
  quantity: initialQuantity,
  leverage: initialLeverage,
  overview,
}: TradeTicketDialogProps) {
  const [open, setOpen] = useState(false);
  const [quantity, setQuantity] = useState(initialQuantity);
  const [stopLoss, setStopLoss] = useState(setup.stopLoss);
  const [takeProfit, setTakeProfit] = useState(setup.takeProfit1);
  const [leverage, setLeverage] = useState(initialLeverage);
  const trade = usePlaceTrade();
  const recheck = useRecheck(setup, open && Boolean(overview?.configured));

  // Свежие уровни после предпроверки — подставляем в заявку, риск в $ сохраняем.
  const fresh = recheck.data?.fresh ?? null;
  useEffect(() => {
    if (!fresh) return;
    setStopLoss(fresh.stopLoss);
    setTakeProfit(fresh.takeProfit1);
    setQuantity(rescaleQuantity(initialQuantity, setup, fresh));
  }, [fresh, initialQuantity, setup]);

  const active = fresh ?? setup;
  const isStale = recheck.data?.status === "stale";
  const isFutures = setup.market === "usdm";
  const notional = quantity * active.entry;
  const loss = quantity * Math.abs(active.entry - stopLoss);
  const profit = quantity * Math.abs(takeProfit - active.entry);
  const balance = isFutures
    ? overview?.balances?.usdm
    : overview?.balances?.spot;

  // Проверка денег и риска до отправки (сервер повторит её сам).
  const wallet = isFutures ? "USDⓈ-M Futures" : "Spot";
  const required = isFutures ? notional / leverage : notional;
  const maxLoss = (balance ?? 0) * MAX_RISK_PCT;
  const riskPerUnit = Math.abs(active.entry - stopLoss);
  const blockers: string[] = [];
  if (balance !== undefined) {
    if (balance <= 0) {
      blockers.push(
        `На демо-кошельке ${wallet} 0 USDT. Пополните его на demo.binance.com (раздел фьючерсов демо-счёта: Faucet / пополнение или перевод со Spot) и обновите страницу.`,
      );
    } else {
      if (required > balance)
        blockers.push(
          `Нужно ${formatUsd(required)} ${isFutures ? "маржи" : "USDT"}, а на ${wallet} свободно ${formatUsd(balance)}.`,
        );
      if (loss > maxLoss)
        blockers.push(
          `Потеря на стопе ${formatUsd(loss)} больше ${MAX_RISK_PCT * 100}% баланса ${wallet} (${formatUsd(maxLoss)}).`,
        );
    }
  }
  const canShrinkToRisk =
    balance !== undefined && balance > 0 && loss > maxLoss && riskPerUnit > 0;

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      // Каждый раз открываем с актуальными уровнями сетапа и калькулятора.
      setQuantity(initialQuantity);
      setStopLoss(setup.stopLoss);
      setTakeProfit(setup.takeProfit1);
      setLeverage(initialLeverage);
      trade.reset();
    }
  };

  const submit = () =>
    trade.mutate({
      symbol: setup.symbol,
      market: setup.market,
      direction: setup.direction,
      quantity,
      stopLoss,
      takeProfit,
      leverage: isFutures ? leverage : 1,
      setupId: setup.id,
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button
          className="w-full"
          variant={setup.status === "ready" ? "default" : "outline"}
          title={
            setup.status === "ready"
              ? "Можно входить: разворотная свеча уже есть"
              : "Ждём разворота: войти можно, но риск выше — разумнее дождаться разворотной свечи"
          }
        >
          <Zap />
          Сделка в 1 клик (демо)
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {setup.direction === "long" ? "Купить" : "Шорт"} {setup.base}
            <Badge variant="outline">
              {isFutures ? `Фьючерс ×${leverage}` : "Spot"}
            </Badge>
            <Badge className="bg-primary/20 text-foreground">DEMO</Badge>
          </DialogTitle>
          <DialogDescription>
            Binance Demo Trading — виртуальные деньги. Вход по рынку, затем
            сразу выставляются Take Profit и Stop Loss.
          </DialogDescription>
        </DialogHeader>

        {!overview ? (
          <p className="text-sm text-muted-foreground">Загрузка…</p>
        ) : !overview.configured ? (
          <SetupInstructions />
        ) : trade.data ? (
          <ResultView result={trade.data} />
        ) : (
          <div className="space-y-4">
            <RecheckBanner
              recheck={recheck.data}
              isPending={recheck.isFetching}
              error={recheck.error}
              onRetry={() => recheck.refetch()}
            />
            <div className="grid grid-cols-2 gap-3">
              <Field
                label={`Количество, ${setup.base}`}
                value={quantity}
                onChange={setQuantity}
              />
              <Field
                label={`Плечо (≤ ${MAX_LEVERAGE}x)`}
                value={isFutures ? leverage : 1}
                step="1"
                disabled={!isFutures}
                onChange={(v) =>
                  setLeverage(
                    Math.min(Math.max(Math.round(v), 1), MAX_LEVERAGE),
                  )
                }
              />
              <Field
                label="Stop Loss"
                value={stopLoss}
                onChange={setStopLoss}
              />
              <Field
                label="Take Profit"
                value={takeProfit}
                onChange={setTakeProfit}
              />
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant={
                  takeProfit === active.takeProfit1 ? "secondary" : "ghost"
                }
                onClick={() => setTakeProfit(active.takeProfit1)}
              >
                TP1 (EMA20)
              </Button>
              <Button
                size="sm"
                variant={
                  takeProfit === active.takeProfit2 ? "secondary" : "ghost"
                }
                onClick={() => setTakeProfit(active.takeProfit2)}
              >
                TP2 (EMA50)
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg bg-muted/50 p-3 text-sm">
              <span className="text-muted-foreground">Объём</span>
              <span className="text-right font-mono">
                {formatUsd(notional)}
              </span>
              <span className="text-muted-foreground">
                {isFutures ? "Маржа" : "Нужно USDT"}
              </span>
              <span className="text-right font-mono">
                {formatUsd(isFutures ? notional / leverage : notional)}
              </span>
              <span className="text-muted-foreground">Если стоп / тейк</span>
              <span className="text-right font-mono">
                <span className="text-destructive">−{formatUsd(loss)}</span> /{" "}
                <span className="text-positive">+{formatUsd(profit)}</span>
              </span>
              <span className="text-muted-foreground">Доступно на демо</span>
              <span className="text-right font-mono">
                {balance === undefined ? "—" : `${formatUsd(balance)} USDT`}
              </span>
            </div>
            {overview.error && (
              <p className="text-xs text-destructive">{overview.error}</p>
            )}
            {blockers.length > 0 && (
              <div className="space-y-2 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm">
                {blockers.map((b) => (
                  <p key={b}>{b}</p>
                ))}
                {canShrinkToRisk && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setQuantity((maxLoss / riskPerUnit) * 0.99)}
                  >
                    Уменьшить количество до риска {MAX_RISK_PCT * 100}%
                  </Button>
                )}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Риск на сделку — не больше {MAX_RISK_PCT * 100}% баланса кошелька,
              объём — не больше {formatUsd(overview.maxNotionalUsd)}. Сервер ещё
              раз проверит уровни, деньги и риск по текущей цене демо.
            </p>
            {trade.error && (
              <p className="text-sm text-destructive">{trade.error.message}</p>
            )}
          </div>
        )}

        <DialogFooter>
          {overview?.configured && !trade.data && (
            <Button
              onClick={submit}
              disabled={
                trade.isPending ||
                recheck.isFetching ||
                isStale ||
                blockers.length > 0
              }
            >
              {trade.isPending
                ? "Отправляю…"
                : recheck.isFetching
                  ? "Проверяю сетап…"
                  : isStale
                    ? "Вход уже не актуален"
                    : blockers.length > 0
                      ? "Исправьте ограничения выше"
                      : "Подтвердить сделку на демо"}
            </Button>
          )}
          {trade.data && (
            <Button variant="outline" onClick={() => setOpen(false)}>
              Готово
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
