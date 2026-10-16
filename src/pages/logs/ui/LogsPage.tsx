"use client";

import {
  parseAsInteger,
  parseAsString,
  parseAsStringLiteral,
  useQueryStates,
} from "nuqs";
import { Suspense, useEffect, useMemo, useState } from "react";
import {
  LOG_DAYS_DEFAULT,
  LOG_DAYS_MAX,
  LOG_LEVELS,
  type LogLevel,
  parseLogFilters,
  useLogs,
} from "@/entities/log-entry";
import { Button } from "@/shared/ui/Button";
import { Input } from "@/shared/ui/Input";
import { Tabs, TabsList, TabsTrigger } from "@/shared/ui/Tabs";
import { LogList } from "@/widgets/log-list";

const LEVEL_LABELS: Record<LogLevel, string> = {
  debug: "Всё",
  info: "Инфо и выше",
  warn: "Предупреждения",
  error: "Ошибки",
};

const DAYS_OPTIONS = [LOG_DAYS_DEFAULT, 7, LOG_DAYS_MAX] as const;

/** 1 день, 2–4 дня, 5+ дней (11–14 — «дней»). */
const daysLabel = (n: number) => {
  const d10 = n % 10;
  const d100 = n % 100;
  if (d10 === 1 && d100 !== 11) return `${n} день`;
  if (d10 >= 2 && d10 <= 4 && (d100 < 12 || d100 > 14)) return `${n} дня`;
  return `${n} дней`;
};

/** Значение с задержкой: текстовые фильтры не шлют запрос на каждое нажатие клавиши. */
function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

// Фильтры — в URL (spec 0016): на них ведёт ссылка из «N отказ · M пропуск» в лаборатории.
const parsers = {
  level: parseAsStringLiteral(LOG_LEVELS).withDefault("info"),
  event: parseAsString.withDefault(""),
  experiment: parseAsString.withDefault(""),
  days: parseAsInteger.withDefault(LOG_DAYS_DEFAULT),
};

function Logs() {
  const [{ level, event, experiment, days }, setFilters] = useQueryStates(
    parsers,
    { clearOnDefault: true },
  );
  // Текст из полей — с задержкой 300 мс; уровень и период — сразу.
  const eventQuery = useDebounced(event, 300);
  const experimentQuery = useDebounced(experiment, 300);
  // Те же правила разбора, что у сервера: события списком, days зажат в 1…14.
  const filters = useMemo(
    () =>
      parseLogFilters(
        new URLSearchParams({
          level,
          event: eventQuery,
          experiment: experimentQuery,
          days: String(days),
        }),
      ),
    [level, eventQuery, experimentQuery, days],
  );
  const logs = useLogs(filters);
  const active =
    filters.events.length > 0 ||
    filters.experiment !== "" ||
    filters.days !== LOG_DAYS_DEFAULT ||
    filters.level !== "info";
  const reset = () => void setFilters(null);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Логи</h1>
        <p className="text-sm text-muted-foreground">
          Журнал сервера за {daysLabel(filters.days)}: запросы к Binance и
          OpenRouter, сделки, предпроверки, отказы и пропуски демо-зеркала,
          ошибки из браузера. Хранится {LOG_DAYS_MAX} дней, обновляется каждые
          10 секунд. Ключи и подписи в журнал не пишутся.
        </p>
      </header>
      <div className="flex flex-col gap-3">
        <Tabs
          value={level}
          onValueChange={(v) => void setFilters({ level: v as LogLevel })}
        >
          <TabsList>
            {LOG_LEVELS.map((l) => (
              <TabsTrigger key={l} value={l}>
                {LEVEL_LABELS[l]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="flex flex-wrap items-center gap-3">
          <Input
            value={event}
            onChange={(e) => void setFilters({ event: e.target.value })}
            placeholder="Событие (через запятую)"
            aria-label="События через запятую"
            className="w-80 font-mono text-xs"
          />
          <Input
            value={experiment}
            onChange={(e) => void setFilters({ experiment: e.target.value })}
            placeholder="Эксперимент"
            aria-label="Код эксперимента"
            className="w-32 font-mono text-xs"
          />
          <Tabs
            value={String(filters.days)}
            onValueChange={(v) => void setFilters({ days: Number(v) })}
          >
            <TabsList>
              {DAYS_OPTIONS.map((d) => (
                <TabsTrigger key={d} value={String(d)}>
                  {daysLabel(d)}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          {active && (
            <Button variant="ghost" size="sm" onClick={reset}>
              Сбросить фильтры
            </Button>
          )}
        </div>
      </div>
      {logs.isPending && <p className="text-muted-foreground">Загрузка…</p>}
      {logs.error && <p className="text-destructive">{logs.error.message}</p>}
      {logs.data && (
        <LogList entries={logs.data} onReset={active ? reset : undefined} />
      )}
    </div>
  );
}

export function LogsPage() {
  return (
    <Suspense>
      <Logs />
    </Suspense>
  );
}
