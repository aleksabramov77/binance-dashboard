import {
  type ExecutedOrder,
  type TradeOverview,
  useTradeHistory,
} from "@/entities/trade";
import {
  cn,
  formatAmount,
  formatDateTime,
  formatPrice,
  formatUsd,
} from "@/shared/lib";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Table, TableBody, TableCell, TableRow } from "@/shared/ui/table";

/** BATUSDT → BAT-USDT. */
const formatPair = (symbol: string) => {
  const quote = symbol.match(/(USDT|USDC|FDUSD)$/)?.[1];
  return quote ? `${symbol.slice(0, -quote.length)}-${quote}` : symbol;
};

function OrderRow({ order }: { order: ExecutedOrder }) {
  const pnl = order.realizedPnl;
  const fees = order.commissions
    .map((c) =>
      c.asset === "USDT"
        ? formatUsd(c.amount)
        : `${formatAmount(c.amount)} ${c.asset}`,
    )
    .join(" + ");
  return (
    <TableRow>
      <TableCell className="text-muted-foreground">
        {formatDateTime(order.at)}
      </TableCell>
      <TableCell
        className={cn(
          "font-semibold",
          order.side === "BUY" ? "text-positive" : "text-destructive",
        )}
      >
        {order.side}
      </TableCell>
      <TableCell className="font-semibold">
        {formatPair(order.symbol)}
      </TableCell>
      <TableCell className="text-muted-foreground">
        {order.market === "spot" ? "Spot" : "Futures"}
      </TableCell>
      <TableCell className="font-mono text-xs">
        {formatAmount(order.quantity)} по {formatPrice(order.avgPrice)} ≈{" "}
        {formatUsd(order.quoteQty)}
        {pnl !== null && pnl !== 0 && (
          <span
            className={cn(
              "ml-2",
              pnl > 0 ? "text-positive" : "text-destructive",
            )}
          >
            PnL {pnl > 0 ? "+" : ""}
            {formatUsd(pnl)}
          </span>
        )}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {fees && `комиссия ${fees}`}
      </TableCell>
    </TableRow>
  );
}

export function TradeLog({ overview }: { overview: TradeOverview }) {
  const history = useTradeHistory();
  const orders = history.data?.orders ?? [];
  const error = history.error?.message ?? history.data?.error;

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
      <CardContent className="space-y-2">
        {!overview.configured ? (
          <p className="text-sm text-muted-foreground">
            Демо-торговля не подключена — нажмите «Сделка в 1 клик» на любом
            сетапе, там инструкция.
          </p>
        ) : history.isPending ? (
          <p className="text-sm text-muted-foreground">
            Загружаю историю с демо-счёта Binance…
          </p>
        ) : (
          <>
            {error && <p className="text-sm text-destructive">{error}</p>}
            {orders.length === 0 ? (
              !error && (
                <p className="text-sm text-muted-foreground">
                  Исполненных сделок на демо-счёте пока нет.
                </p>
              )
            ) : (
              <Table>
                <TableBody>
                  {orders.map((o) => (
                    <OrderRow key={o.id} order={o} />
                  ))}
                </TableBody>
              </Table>
            )}
            <p className="text-xs text-muted-foreground">
              Исполненные ордера с демо-счёта Binance (вход, срабатывание TP/SL,
              ручные закрытия). Отклонённые попытки — в «Логах».
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
