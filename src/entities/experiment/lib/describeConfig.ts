import type {
  EntryRule,
  ExitRule,
  ExperimentConfig,
  Universe,
} from "@binance-dashboard/trading-core";

// Конфиг эксперимента человеческим текстом для детальной страницы /experiments/[id].

const COUNTER_TREND: Record<
  Extract<EntryRule, { type: "counterTrend" }>["mode"],
  string
> = {
  rebound: "сканер: отскок после сильного падения",
  overheat: "сканер: шорт после перегретого пампа",
  both: "сканер: отскок после падения и шорт после пампа",
  pumpContinuation: "сканер: продолжение пампа",
};

const decimal = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 4 });
const num = (value: number) => decimal.format(value);
const pct = (value: number) => `${num(value)} %`;

export function describeEntry(entry: EntryRule): string {
  switch (entry.type) {
    case "counterTrend":
      return COUNTER_TREND[entry.mode];
    case "emaCross":
      return `пересечение EMA ${entry.fast} и EMA ${entry.slow}`;
    case "donchian":
      return `пробой канала Дончиана ${entry.period} свечей${
        entry.volumeMult
          ? ` с объёмом ≥ ${num(entry.volumeMult)}× среднего`
          : ""
      }`;
    case "rsi2":
      return `RSI(2) ниже ${entry.threshold} выше SMA ${entry.trendSma}`;
    case "bbReversion":
      return `возврат к средней Боллинджера (вход у нижней полосы, RSI ≤ ${entry.rsiMax})`;
    case "bbSqueeze":
      return `пробой после сжатия Боллинджера (ширина ≤ ${pct(entry.maxWidth * 100)})`;
    case "macd":
      return `пересечение MACD и сигнальной${
        entry.minAdx ? ` при ADX ≥ ${entry.minAdx}` : ""
      }`;
    case "supertrend":
      return `разворот Supertrend (${entry.period}, ${num(entry.mult)})`;
    case "volumeSpike":
      return `всплеск объёма ≥ ${num(entry.mult)}× среднего`;
    case "emaPullback":
      return "откат к EMA 20 в тренде";
    case "momentum":
      return `моментум: топ-${entry.topK} по росту за ${entry.lookbackBars} свечей`;
    case "random":
      return `случайный вход с вероятностью ${pct(entry.probability * 100)} (контроль)`;
    case "hold":
      return "купить и держать (контроль)";
    case "funding":
      return `экстремальный funding rate (|ставка| ≥ ${pct(entry.threshold * 100)})`;
  }
}

export function describeStop(stop: ExitRule["stop"]): string {
  switch (stop.type) {
    case "atr":
      return `${num(stop.mult)} × ATR от входа`;
    case "pct":
      return `${pct(stop.pct)} от входа`;
    case "signal":
      return "уровень от сигнала (swing)";
    case "none":
      return "без стопа";
  }
}

export function describeTakeProfit(tp: ExitRule["takeProfit"]): string {
  if (tp === null) return "без тейка";
  switch (tp.type) {
    case "rr":
      return `${num(tp.r)} R`;
    case "pct":
      return `${pct(tp.pct)} от входа`;
    case "signal":
      return "цель от сигнала (средняя BB, EMA 20)";
  }
}

export function describeUniverse(u: Universe): string {
  const base = {
    majors: "мейджоры (BTC, ETH, SOL, BNB, XRP)",
    top: `топ-${u.n ?? 0} по обороту за 24 ч`,
    movers: `${u.n ?? 0} лидеров роста и ${u.n ?? 0} падения за 24 ч`,
    symbols: (u.symbols ?? []).join(", "),
  }[u.type];
  return u.blacklist?.length ? `${base}; без ${u.blacklist.join(", ")}` : base;
}

export interface ConfigLine {
  label: string;
  value: string;
}

/** Конфиг эксперимента строками «параметр — значение». */
export function describeConfig(c: ExperimentConfig): ConfigLine[] {
  const { exit } = c;
  const lines: ConfigLine[] = [
    { label: "Таймфрейм", value: c.timeframe },
    { label: "Вход", value: describeEntry(c.entry) },
    {
      label: "Направление",
      value: c.directions
        .map((d) => (d === "long" ? "лонг" : "шорт"))
        .join(" и "),
    },
    { label: "Стоп", value: describeStop(exit.stop) },
    { label: "Тейк", value: describeTakeProfit(exit.takeProfit) },
    {
      label: "Трейлинг",
      value: exit.trailAtr
        ? `${num(exit.trailAtr)} × ATR от экстремума`
        : "нет",
    },
    { label: "Юниверс", value: describeUniverse(c.universe) },
    { label: "Позиций одновременно", value: String(c.maxOpen) },
  ];
  if (c.trendFilter)
    lines.push({
      label: "Фильтр тренда",
      value: `по EMA ${c.trendFilter.period} на ${c.trendFilter.timeframe}`,
    });
  if (exit.breakevenAtR)
    lines.push({
      label: "Безубыток",
      value: `при +${num(exit.breakevenAtR)} R`,
    });
  if (exit.timeStopBars)
    lines.push({
      label: "Выход по времени",
      value: `через ${exit.timeStopBars} свечей ${c.timeframe}`,
    });
  if (exit.exitOnSignal)
    lines.push({ label: "Выход по сигналу", value: "противоположный сигнал" });
  return lines;
}
