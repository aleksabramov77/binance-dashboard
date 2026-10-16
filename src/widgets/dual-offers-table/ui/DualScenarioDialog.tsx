"use client";

import {
  DUAL_SIDE_LABELS,
  type DualOffer,
  dualScenarios,
} from "@/entities/earn-product";
import {
  formatAmount,
  formatDateTime,
  formatPercent,
  formatPrice,
  formatUsd,
} from "@/shared/lib";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/Dialog";

const money = (amount: number, asset: string) =>
  `${formatAmount(amount)} ${asset}`;

/** Карточка предложения Dual: два исхода на дату расчёта простыми словами. */
export function DualScenarioDialog({
  offer,
  amountUsd,
  onClose,
}: {
  offer: DualOffer | null;
  amountUsd: number;
  onClose: () => void;
}) {
  return (
    <Dialog open={offer !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
        {offer && <ScenarioBody offer={offer} amountUsd={amountUsd} />}
      </DialogContent>
    </Dialog>
  );
}

function ScenarioBody({
  offer,
  amountUsd,
}: {
  offer: DualOffer;
  amountUsd: number;
}) {
  const s = dualScenarios(offer, amountUsd);
  const e = s?.evaluation;
  const date = formatDateTime(offer.settleAt);
  const strike = `${formatPrice(offer.strikePrice)} ${offer.stable}`;
  const sellHigh = offer.side === "sell-high";
  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {offer.coin} / {offer.stable} · {DUAL_SIDE_LABELS[offer.side]}
        </DialogTitle>
        <DialogDescription>
          {sellHigh
            ? `Вы вкладываете ${offer.coin} и готовы продать его по ${strike} — дороже, чем сейчас.`
            : `Вы вкладываете ${offer.stable} и готовы купить ${offer.coin} по ${strike} — дешевле, чем сейчас.`}{" "}
          Целевая цена проверяется {date}. Доход {formatPercent(offer.apr)}{" "}
          годовых за {offer.durationDays} дн. платят при любом исходе.
        </DialogDescription>
      </DialogHeader>
      {!s || !e ? (
        <p className="text-sm text-muted-foreground">
          Введите сумму больше нуля
          {sellHigh ? " (и нужна текущая цена монеты)" : ""}, чтобы посчитать
          исходы.
        </p>
      ) : (
        <div className="space-y-4 text-sm">
          <p>
            Вкладываете: <b>{money(s.invest.amount, s.invest.asset)}</b>
            {sellHigh && ` (≈ ${formatUsd(amountUsd)})`}. Доход за срок:{" "}
            <b>{formatPercent(e.periodReturn)}</b> ≈ {formatUsd(e.incomeUsd)}.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border p-3">
              <p className="font-medium">
                Если {date} цена {offer.coin} {sellHigh ? "≥" : "≤"} {strike}
              </p>
              <p className="mt-1">
                {sellHigh ? "Ваши монеты продадутся" : "Вы купите монеты"} по
                целевой цене. Получите{" "}
                <b>{money(s.exercised.amount, s.exercised.asset)}</b>.
              </p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="font-medium">
                Если {sellHigh ? "ниже" : "выше"} {strike}
              </p>
              <p className="mt-1">
                Обмена не будет: вернётся то, что вложили, плюс доход —{" "}
                <b>{money(s.notExercised.amount, s.notExercised.asset)}</b>.
              </p>
            </div>
          </div>
          <p>
            Эффективная цена {sellHigh ? "продажи" : "покупки"} с учётом дохода:{" "}
            <b>
              {formatPrice(s.effectivePrice)} {offer.stable}
            </b>
            {offer.price !== null &&
              ` (сейчас ${offer.coin} стоит ${formatPrice(offer.price)} ${offer.stable})`}
            .
          </p>
          <p className="rounded-lg bg-muted p-3 text-muted-foreground">
            {sellHigh
              ? `Риск: если ${offer.coin} сильно вырастет, вы всё равно продадите его по ${strike} и упустите рост.`
              : `Риск: если ${offer.coin} сильно упадёт, вы всё равно купите его по ${strike} — дороже рынка — и окажетесь в убытке в долларах.`}{" "}
            Деньги заморожены до даты расчёта. Подходит, только если вы и так
            готовы {sellHigh ? "продать" : "купить"} {offer.coin} по этой цене.
          </p>
          {(e.belowMinimum || e.aboveMaximum) && (
            <p className="text-destructive">
              {e.belowMinimum
                ? `Сумма меньше минимума: ${money(offer.minAmount, s.invest.asset)}.`
                : `Сумма больше лимита: ${money(offer.maxAmount, s.invest.asset)}.`}
            </p>
          )}
        </div>
      )}
    </>
  );
}
