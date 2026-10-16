"use client";

import {
  EARN_KIND_INFO,
  KindBadge,
  PrincipalBadge,
  RiskDots,
  type YieldProduct,
} from "@/entities/earn-product";
import {
  cn,
  defineSortTable,
  formatAmount,
  formatPercent,
  formatUsd,
  type SortValue,
  sortRows,
  useTableSort,
} from "@/shared/lib";
import { Badge } from "@/shared/ui/Badge";
import { SortableHead } from "@/shared/ui/SortableHead";
import {
  Table,
  TableBody,
  TableCell,
  TableFrame,
  TableHeader,
  TableRow,
} from "@/shared/ui/Table";
import { termLabel } from "../lib/termLabel";

const SORT_KEYS = [
  "product",
  "apr",
  "term",
  "yearly",
  "risk",
  "protected",
  "quota",
] as const;
type SortKey = (typeof SORT_KEYS)[number];
const SORT_TABLE = defineSortTable("earn:yield", SORT_KEYS);

const HELP: Record<SortKey, string> = {
  product:
    "Продукт, вид и что вкладываете. Если награда приходит другим токеном — он указан после стрелки.",
  apr: "Годовая ставка сейчас. У стейкинга и RWUSD/BFUSD — последняя опубликованная Binance, она меняется каждый день.",
  term: "Сколько деньги заморожены: «на N дн.» — до конца срока; «гибкий» — выйти можно в любой момент, но возврат может занять несколько дней.",
  yearly:
    "Доход за год на вашу сумму в $ по текущей ставке. Курс монеты не учтён: если вкладываете не стейблкоин, результат в $ зависит от цены.",
  risk: "Риск вида продукта от 1 (почти как вклад) до 5 (можно потерять заметную часть). Подробно — во вкладке «Гид».",
  protected:
    "Вернётся ли то же количество монет, что вложили. «Не защищён» — можно получить меньше.",
  quota: "Сколько ещё можно вложить вам лично (и минимум для входа).",
};

const SORT_VALUE: Record<SortKey, (p: YieldProduct) => SortValue> = {
  product: (p) => p.name,
  apr: (p) => p.apr,
  term: (p) => p.lockDays ?? p.redemptionDays,
  yearly: (p) => p.apr,
  risk: (p) => EARN_KIND_INFO[p.kind].riskLevel,
  protected: (p) => EARN_KIND_INFO[p.kind].principalProtected,
  quota: (p) => (p.quotaLeft === null ? null : p.quotaLeft * (p.priceUsd ?? 1)),
};

/**
 * По умолчанию: основные продукты вкладки (RWUSD/BFUSD → стейкинг → DeFi), Soft Staking — в конце
 * (это десятки мелких альткоинов); внутри вида — по ставке.
 */
const DEFAULT_KIND_ORDER: YieldProduct["kind"][] = [
  "rwusd",
  "bfusd",
  "eth-staking",
  "sol-staking",
  "onchain",
  "soft-staking",
];

function defaultOrder(products: YieldProduct[]): YieldProduct[] {
  return [...products].sort(
    (a, b) =>
      DEFAULT_KIND_ORDER.indexOf(a.kind) - DEFAULT_KIND_ORDER.indexOf(b.kind) ||
      (b.apr ?? 0) - (a.apr ?? 0),
  );
}

export function YieldProductsTable({
  products,
  amountUsd,
}: {
  products: YieldProduct[];
  amountUsd: number;
}) {
  const { sort, head } = useTableSort(SORT_TABLE);
  const ordered = defaultOrder(products);
  const rows = sort
    ? sortRows(ordered, SORT_VALUE[sort.key], sort.dir)
    : ordered;
  if (products.length === 0)
    return (
      <p className="rounded-xl border border-dashed p-10 text-center text-muted-foreground">
        Сейчас предложений нет.
      </p>
    );
  const right = "text-right";
  return (
    <TableFrame>
      <Table>
        <TableHeader>
          <TableRow>
            <SortableHead {...head("product")} description={HELP.product}>
              Продукт
            </SortableHead>
            <SortableHead
              className={right}
              {...head("apr")}
              description={HELP.apr}
            >
              APR
            </SortableHead>
            <SortableHead {...head("term")} description={HELP.term}>
              Срок / вывод
            </SortableHead>
            <SortableHead
              className={right}
              {...head("yearly")}
              description={HELP.yearly}
            >
              Доход / год
            </SortableHead>
            <SortableHead {...head("risk")} description={HELP.risk}>
              Риск
            </SortableHead>
            <SortableHead {...head("protected")} description={HELP.protected}>
              Капитал
            </SortableHead>
            <SortableHead
              className={right}
              {...head("quota")}
              description={HELP.quota}
            >
              Квота
            </SortableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((p) => (
            <TableRow key={p.id} className={cn(p.soldOut && "opacity-50")}>
              <TableCell>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{p.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {p.asset}
                    {p.rewardAsset && ` → ${p.rewardAsset}`}
                  </span>
                  <KindBadge kind={p.kind} />
                  {p.soldOut && <Badge variant="outline">распродано</Badge>}
                </div>
              </TableCell>
              <TableCell className="text-right font-mono font-semibold tabular-nums">
                {p.apr === null ? "—" : formatPercent(p.apr)}
              </TableCell>
              <TableCell className="whitespace-nowrap text-sm">
                {termLabel(p)}
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {p.apr === null || amountUsd <= 0
                  ? "—"
                  : formatUsd(amountUsd * p.apr)}
              </TableCell>
              <TableCell>
                <RiskDots level={EARN_KIND_INFO[p.kind].riskLevel} />
              </TableCell>
              <TableCell>
                <PrincipalBadge kind={p.kind} />
              </TableCell>
              <TableCell className="text-right text-sm text-muted-foreground">
                {p.quotaLeft === null
                  ? "—"
                  : `${formatAmount(p.quotaLeft)} ${p.asset}`}
                {p.minPurchase !== null && (
                  <div className="text-xs">
                    мин. {formatAmount(p.minPurchase)} {p.asset}
                  </div>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableFrame>
  );
}
