"use client";

import { parseAsStringLiteral, useQueryState } from "nuqs";
import { Suspense } from "react";
import { LOG_LEVELS, type LogLevel, useLogs } from "@/entities/log-entry";
import { Tabs, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { LogList } from "@/widgets/log-list";

const LEVEL_LABELS: Record<LogLevel, string> = {
  debug: "Всё",
  info: "Инфо и выше",
  warn: "Предупреждения",
  error: "Ошибки",
};

function Logs() {
  const [level, setLevel] = useQueryState(
    "level",
    parseAsStringLiteral(LOG_LEVELS).withDefault("info"),
  );
  const logs = useLogs(level);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Логи</h1>
        <p className="text-sm text-muted-foreground">
          Журнал сервера за сегодня и вчера: запросы к Binance и OpenRouter,
          сделки, предпроверки и ошибки из браузера. Обновляется каждые 10
          секунд. Файлы — <code>data/logs/app-YYYY-MM-DD.jsonl</code>; ключи и
          подписи в журнал не пишутся.
        </p>
      </header>
      <Tabs value={level} onValueChange={(v) => setLevel(v as LogLevel)}>
        <TabsList>
          {LOG_LEVELS.map((l) => (
            <TabsTrigger key={l} value={l}>
              {LEVEL_LABELS[l]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {logs.isPending && <p className="text-muted-foreground">Загрузка…</p>}
      {logs.error && <p className="text-destructive">{logs.error.message}</p>}
      {logs.data && <LogList entries={logs.data} />}
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
