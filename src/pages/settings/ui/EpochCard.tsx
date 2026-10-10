"use client";

import { useId, useState } from "react";
import {
  type LabSettings,
  RESET_CONFIRM_WORD,
  useResetCapitals,
} from "@/entities/experiment";
import { formatDateTime, formatUsd } from "@/shared/lib";
import { Button } from "@/shared/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/ui/card";
import { Input } from "@/shared/ui/input";

/** Текущая эпоха и «Сбросить тестовые капиталы» с подтверждением вводом слова. */
export function EpochCard({ settings }: { settings: LabSettings }) {
  const { epoch } = settings;
  const reset = useResetCapitals();
  const noteId = useId();
  const wordId = useId();
  const [confirming, setConfirming] = useState(false);
  const [word, setWord] = useState("");
  const [note, setNote] = useState("");
  const confirmed = word.trim().toUpperCase() === RESET_CONFIRM_WORD;

  const close = () => {
    setConfirming(false);
    setWord("");
    setNote("");
  };

  const submit = () =>
    reset.mutate(
      { fromRunId: epoch.id, note: note.trim() || undefined },
      { onSuccess: close },
    );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Эпоха #{epoch.id}</CardTitle>
        <CardDescription>
          Начата {formatDateTime(epoch.startedAt)}
          {epoch.note ? ` · ${epoch.note}` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt className="text-muted-foreground">Сделок в эпохе</dt>
          <dd className="font-medium tabular-nums">{epoch.trades}</dd>
          <dt className="text-muted-foreground">Из них открыто</dt>
          <dd className="font-medium tabular-nums">{epoch.openTrades}</dd>
        </dl>

        {reset.data && (
          <output className="block text-sm text-muted-foreground">
            {reset.data.created
              ? `Начата эпоха #${reset.data.epoch.id}; закрыто сделок: ${reset.data.closed}` +
                (reset.data.closedWithoutPrice
                  ? ` (без цены, по цене входа: ${reset.data.closedWithoutPrice})`
                  : "")
              : `Эпоха уже сменилась — сейчас #${reset.data.epoch.id}, повторный сброс не выполнен.`}
          </output>
        )}

        {!confirming ? (
          <Button
            variant="destructive"
            className="self-start"
            onClick={() => {
              reset.reset();
              setConfirming(true);
            }}
          >
            Сбросить тестовые капиталы
          </Button>
        ) : (
          <div className="flex flex-col gap-3 rounded-lg border border-destructive/50 p-4">
            <p className="text-sm">
              Открытые сделки эпохи #{epoch.id} ({epoch.openTrades}) закроются
              по последней цене с причиной «manual», начнётся эпоха #
              {epoch.id + 1} с бюджетом {formatUsd(settings.nextBudget)} на
              каждый рынок (поровну между его экспериментами), сделки по $50.
              Старые сделки остаются в истории. Тумблер движка не меняется.
            </p>
            <label htmlFor={noteId} className="flex flex-col gap-1 text-sm">
              Заметка к новой эпохе (необязательно)
              <Input
                id={noteId}
                value={note}
                maxLength={200}
                placeholder="Например: после правки стопов"
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            <label htmlFor={wordId} className="flex flex-col gap-1 text-sm">
              Введите «{RESET_CONFIRM_WORD}», чтобы подтвердить
              <Input
                id={wordId}
                value={word}
                autoComplete="off"
                aria-invalid={word.length > 0 && !confirmed}
                onChange={(e) => setWord(e.target.value)}
              />
            </label>
            {reset.error && (
              <p className="text-sm text-destructive">{reset.error.message}</p>
            )}
            <div className="flex gap-2">
              <Button
                variant="destructive"
                disabled={!confirmed || reset.isPending}
                onClick={submit}
              >
                {reset.isPending ? "Сбрасываю…" : "Подтвердить сброс"}
              </Button>
              <Button
                variant="outline"
                disabled={reset.isPending}
                onClick={close}
              >
                Отмена
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
