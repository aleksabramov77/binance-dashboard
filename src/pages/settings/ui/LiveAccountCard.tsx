"use client";

import { useEffect, useRef } from "react";
import {
  deriveLiveStatus,
  type LiveHeartbeat,
  type LiveStatus,
  useLiveAccount,
} from "@/entities/live-account";
import { LIVE_FLAG_RULES, LIVE_KEY_FLAGS } from "@/shared/api/binance";
import { cn, formatDateTime, formatUsd } from "@/shared/lib";
import { Badge } from "@/shared/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/ui/card";

// Карточка «Реальный счёт» (spec 0047, AC5): состояние торгового ключа субсчёта по последнему пульсу воркера.
// Ключа у веб-приложения нет — всё, что здесь видно, прислал воркер с VM. Сделок пока нет.

const ANCHOR = "live";

function StatusLine({ status }: { status: LiveStatus }) {
  switch (status.kind) {
    case "not-connected":
      return (
        <p className="font-medium">
          Не подключён — воркер ещё ни разу не присылал пульс.
        </p>
      );
    case "silent":
      return (
        <p className="font-medium text-destructive">
          ⚠️ Воркер молчит с {formatDateTime(status.since)}
        </p>
      );
    case "no-key":
      return (
        <p className="font-medium">
          ⚪ Ключ не задан: воркер работает, но у него нет BINANCE_TRADE_API_KEY
          / SECRET
        </p>
      );
    case "blocked":
      return (
        <div className="flex flex-col gap-1">
          <p className="font-medium text-destructive">⛔ Ключ заблокирован:</p>
          <ul className="list-disc pl-5 text-sm">
            {status.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      );
    case "ok":
      return (
        <div className="flex flex-col gap-1">
          <p className="font-medium text-positive">
            ✅ Ключ годится · торговля выключена
          </p>
          {status.warnings.map((w) => (
            <p key={w} className="text-sm">
              ⚠️ {w}
            </p>
          ))}
        </div>
      );
  }
}

/** Права ключа галочками: что нужно и что у ключа сейчас. */
function KeyFlags({ heartbeat }: { heartbeat: LiveHeartbeat }) {
  const flags = heartbeat.restrictions.flags;
  if (!flags)
    return (
      <p className="text-sm text-muted-foreground">
        Права ключа ещё не прочитаны.
      </p>
    );
  return (
    <ul className="flex flex-col gap-0.5 text-sm">
      {LIVE_KEY_FLAGS.map((flag) => {
        const rule = LIVE_FLAG_RULES[flag];
        const good = flags[flag] === rule.expected;
        const icon = good ? "✅" : rule.warningOnly ? "⚠️" : "⛔";
        return (
          <li key={flag} className={cn(!good && "font-medium")}>
            {icon} {rule.label}:{" "}
            <span className="text-muted-foreground">
              {flags[flag] ? "вкл" : "выкл"} (нужно{" "}
              {rule.expected ? "вкл" : "выкл"})
            </span>
          </li>
        );
      })}
    </ul>
  );
}

const UID_TEXT = {
  different: "✅ субсчёт (UID не совпадает с основным счётом)",
  same: "⛔ ключ основного счёта",
  skipped: "⚪ не проверено",
  pending: "⛔ ждём UID основного счёта",
  unread: "⛔ UID основного счёта не прочитан",
} as const;

function Balances({ heartbeat }: { heartbeat: LiveHeartbeat }) {
  const { spot, usdm } = heartbeat;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
      <dt className="text-muted-foreground">Spot</dt>
      <dd>
        {spot ? (
          <>
            USDT {formatUsd(spot.usdtFree + spot.usdtLocked)}
            {spot.usdtLocked > 0 &&
              ` (в ордерах ${formatUsd(spot.usdtLocked)})`}
            {" · "}
            {spot.equityUsd === null
              ? "equity в $ — нет цен"
              : `equity ${formatUsd(spot.equityUsd)}`}
            {spot.unpriced.length > 0 &&
              ` · без цены: ${spot.unpriced.join(", ")}`}
          </>
        ) : (
          "—"
        )}
      </dd>
      <dt className="text-muted-foreground">USDⓈ-M</dt>
      <dd>
        {usdm
          ? `кошелёк ${formatUsd(usdm.walletBalance)} · доступно ${formatUsd(usdm.availableBalance)} · нереализ. PnL ${formatUsd(usdm.unrealizedProfit)}`
          : "—"}
      </dd>
      {heartbeat.balancesNote && (
        <dd className="col-span-2 text-muted-foreground">
          {heartbeat.balancesNote}
        </dd>
      )}
    </dl>
  );
}

/** Шаги на Binance (руками, пользователь) — точные английские названия кнопок. */
function HowToConnect({ open }: { open: boolean }) {
  return (
    <details open={open} className="text-sm">
      <summary className="cursor-pointer font-medium">Как подключить</summary>
      <ol className="mt-2 flex list-decimal flex-col gap-1 pl-5">
        <li>
          Основной счёт: <b>Account → Sub Accounts → Create Sub Account</b>{" "}
          (нужны KYC и 2FA). Почта — виртуальная.
        </li>
        <li>
          Субсчёту включить фьючерсы:{" "}
          <b>
            Sub Accounts → Account Management → [субсчёт] → Futures → Enable
          </b>
          .
        </li>
        <li>
          Перевести деньги руками:{" "}
          <b>Sub Accounts → Asset Management → Transfer</b> (основной Spot →
          Spot субсчёта, затем внутри субсчёта Spot → USDⓈ-M). Старт — $80–100.
        </li>
        <li>
          Ключ субсчёта:{" "}
          <b>Sub Accounts → API Management → [субсчёт] → Create API</b>.
          Включить только <b>Enable Reading</b>,{" "}
          <b>Enable Spot &amp; Margin Trading</b>, <b>Enable Futures</b>;{" "}
          <b>Restrict access to trusted IPs only</b> → постоянный IP VM. Не
          включать <b>Enable Withdrawals</b>, <b>Enable Internal Transfer</b>,{" "}
          <b>Permits Universal Transfer</b>,{" "}
          <b>Enable Margin Loan, Repay &amp; Transfer</b>.
        </li>
        <li>
          Ключ и секрет — в env воркера на VM (
          <code>/etc/binance-live/app.env</code>:{" "}
          <code>BINANCE_TRADE_API_KEY</code>,{" "}
          <code>BINANCE_TRADE_API_SECRET</code>, <code>LIVE_WORKER_SECRET</code>
          , <code>LIVE_APP_URL</code>), не в чат и не на Vercel. Тот же{" "}
          <code>LIVE_WORKER_SECRET</code> — в переменных Vercel. Запустить
          воркер — через минуту здесь появится пульс.
        </li>
      </ol>
    </details>
  );
}

export function LiveAccountCard() {
  const ref = useRef<HTMLDivElement>(null);
  const live = useLiveAccount();
  const state = live.data?.state ?? null;
  const status = live.data
    ? deriveLiveStatus(state, Date.now(), live.data.silentAfterMs)
    : null;
  const heartbeat = state?.heartbeat ?? null;

  // Карточка рендерится после загрузки — к якорю #live (ссылка из Telegram) браузер ещё не прокрутил.
  useEffect(() => {
    if (live.data && window.location.hash === `#${ANCHOR}`)
      ref.current?.scrollIntoView({ block: "start" });
  }, [live.data]);

  return (
    <Card id={ANCHOR} ref={ref} className="scroll-mt-4">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          Реальный счёт
          {heartbeat?.fixture && (
            <Badge variant="outline">фикстура: {heartbeat.fixture}</Badge>
          )}
        </CardTitle>
        <CardDescription>
          Торговый субсчёт Binance (спот и USDⓈ-M). Ключ с чтением и торговлей —
          только у воркера на VM, выводов и переводов у него нет. Сделок пока
          нет: воркер проверяет ключ и раз в минуту присылает пульс.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {live.isPending && <p className="text-muted-foreground">Загрузка…</p>}
        {live.error && <p className="text-destructive">{live.error.message}</p>}
        {status && <StatusLine status={status} />}
        {heartbeat && state && (
          <>
            <div className="flex flex-col gap-1">
              <h3 className="text-sm font-semibold">Права ключа</h3>
              <KeyFlags heartbeat={heartbeat} />
              <p className="text-sm">
                <span className="text-muted-foreground">UID-проверка: </span>
                {heartbeat.uid ? UID_TEXT[heartbeat.uid.status] : "—"}
                {heartbeat.uid?.note &&
                  heartbeat.uid.status === "skipped" &&
                  ` (${heartbeat.uid.note})`}
              </p>
            </div>
            <div className="flex flex-col gap-1">
              <h3 className="text-sm font-semibold">Остатки субсчёта</h3>
              <Balances heartbeat={heartbeat} />
            </div>
            {heartbeat.error && (
              <p className="text-sm text-destructive">
                Ошибка биржи в последнем пульсе: {heartbeat.error}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Последний пульс: {formatDateTime(state.receivedAt)}
              {heartbeat.restrictions.checkedAt &&
                ` · права проверены ${formatDateTime(heartbeat.restrictions.checkedAt)}`}
              {` · воркер ${heartbeat.version}`}
            </p>
          </>
        )}
        {status && <HowToConnect open={status.kind === "not-connected"} />}
      </CardContent>
    </Card>
  );
}
