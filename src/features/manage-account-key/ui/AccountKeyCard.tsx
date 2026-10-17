"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useId, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import {
  AccountKeyError,
  type AccountKeyInput,
  type AccountKeyStatus,
  accountKeyInputSchema,
  hintText,
  useAccountKeyStatus,
} from "@/entities/account-key";
import {
  READ_KEY_FLAG_RULES,
  READ_KEY_FLAGS,
  type ReadKeyFlags,
} from "@/shared/api/binance";
import { cn, formatDateTime } from "@/shared/lib";
import { Button } from "@/shared/ui/Button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/ui/Card";
import { ConfirmAction } from "@/shared/ui/ConfirmAction";
import { Input } from "@/shared/ui/Input";
import {
  useDeleteAccountKey,
  useSaveAccountKey,
} from "../api/useAccountKeyMutations";

// Карточка «Основной аккаунт — read-only ключ» (spec 0065): ввод ключа на сайте, проверка прав в Binance, статус
// «…AB12», замена и удаление. Сам ключ после сохранения не показывается нигде — только последние 4 символа.

/** Якорь карточки: ссылки из «Портфеля» и Earn ведут сюда. */
const ACCOUNT_KEY_ANCHOR = "account-key";

const EMPTY: AccountKeyInput = { apiKey: "", apiSecret: "" };

/** Права ключа строками «да/нет»: что у ключа и что нужно. */
function KeyFlags({ flags }: { flags: ReadKeyFlags }) {
  return (
    <ul className="flex flex-col gap-0.5 text-sm">
      {READ_KEY_FLAGS.map((flag) => {
        const rule = READ_KEY_FLAG_RULES[flag];
        const good = flags[flag] === rule.expected;
        return (
          <li key={flag} className={cn(!good && "font-medium")}>
            {good ? "✅" : "⛔"} {rule.label}:{" "}
            <span className="text-muted-foreground">
              {flags[flag] ? "да" : "нет"} (нужно {rule.expected ? "да" : "нет"}
              )
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Что нужно включить у ключа в Binance — те же правила, что проверяет сервер. */
function Requirements() {
  const on = READ_KEY_FLAGS.filter((f) => READ_KEY_FLAG_RULES[f].expected);
  const off = READ_KEY_FLAGS.filter((f) => !READ_KEY_FLAG_RULES[f].expected);
  return (
    <p className="text-sm text-muted-foreground">
      Ключ основного аккаунта (не субсчёта). Включить:{" "}
      {on.map((f, i) => (
        <span key={f}>
          {i > 0 && ", "}
          <b>{READ_KEY_FLAG_RULES[f].label}</b>
        </span>
      ))}{" "}
      (с IP сервера). Выключить всё остальное:{" "}
      {off.map((f) => READ_KEY_FLAG_RULES[f].label).join(", ")}.
    </p>
  );
}

function KeyForm({
  status,
  onDone,
  onCancel,
}: {
  status: AccountKeyStatus;
  onDone: () => void;
  onCancel?: () => void;
}) {
  const keyId = useId();
  const secretId = useId();
  const save = useSaveAccountKey();
  const form = useForm<AccountKeyInput>({
    resolver: zodResolver(accountKeyInputSchema),
    defaultValues: EMPTY,
  });
  const { errors } = form.formState;
  const reasons =
    save.error instanceof AccountKeyError ? save.error.reasons : [];

  if (!status.input.available)
    return (
      <p className="text-sm">
        ⚪ Ввод ключа на сайте недоступен: {status.input.reason}. Мастер-ключ
        создаёт <code>scripts/server/add-project.sh</code>, путь к нему —{" "}
        <code>SECRETS_KEY_FILE</code> в env приложения.
      </p>
    );

  return (
    <form
      className="flex flex-col gap-3"
      autoComplete="off"
      onSubmit={form.handleSubmit((values) =>
        save.mutate(values, {
          onSuccess: () => {
            // Секрет не остаётся в состоянии формы после сохранения.
            form.reset(EMPTY);
            onDone();
          },
        }),
      )}
    >
      <label htmlFor={keyId} className="flex flex-col gap-1 text-sm">
        API Key
        <Input
          id={keyId}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={Boolean(errors.apiKey)}
          {...form.register("apiKey")}
        />
      </label>
      {errors.apiKey && (
        <p className="text-sm text-destructive">{errors.apiKey.message}</p>
      )}
      <label htmlFor={secretId} className="flex flex-col gap-1 text-sm">
        Secret Key
        <Input
          id={secretId}
          type="password"
          autoComplete="new-password"
          spellCheck={false}
          aria-invalid={Boolean(errors.apiSecret)}
          {...form.register("apiSecret")}
        />
      </label>
      {errors.apiSecret && (
        <p className="text-sm text-destructive">{errors.apiSecret.message}</p>
      )}
      {save.error && (
        <div className="flex flex-col gap-1 text-sm text-destructive">
          <p className="font-medium">⛔ {save.error.message}</p>
          {reasons.length > 0 && (
            <ul className="list-disc pl-5">
              {reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? "Проверяю в Binance…" : "Проверить и сохранить"}
        </Button>
        {onCancel && (
          <Button
            type="button"
            variant="outline"
            disabled={save.isPending}
            onClick={onCancel}
          >
            Отмена
          </Button>
        )}
      </div>
    </form>
  );
}

function DeleteKey({ hint }: { hint: string }) {
  const remove = useDeleteAccountKey();
  return (
    <ConfirmAction
      label="Удалить ключ"
      title={`Удалить ключ ${hintText(hint)}?`}
      description="Ключ сотрётся из базы. «Портфель» и сложные продукты Earn снова покажут инструкцию по подключению, пока ключ не введён заново."
      confirmLabel="Удалить"
      pending={remove.isPending}
      error={remove.error?.message ?? null}
      onOpen={() => remove.reset()}
      onConfirm={(close) => remove.mutate(undefined, { onSuccess: close })}
    />
  );
}

function SourceNote({ status }: { status: AccountKeyStatus }) {
  if (status.source === "env")
    return (
      <p className="text-sm text-muted-foreground">
        Сейчас используется ключ из env (<code>BINANCE_API_KEY</code> в{" "}
        <code>.env.local</code>).
        {status.input.available && " Ключ, введённый здесь, главнее."}
      </p>
    );
  if (status.source === "none" && !status.stored)
    return (
      <p className="text-sm">
        ⚪ Ключ не задан: «Портфель» показывает инструкцию, в Earn нет сложных
        продуктов, воркер реального счёта не знает UID основного счёта.
      </p>
    );
  return null;
}

export function AccountKeyCard() {
  const ref = useRef<HTMLDivElement>(null);
  const query = useAccountKeyStatus();
  const [replacing, setReplacing] = useState(false);
  const status = query.data;
  const stored = status?.stored ?? null;
  const usable = stored !== null && !status?.decryptFailed;

  // Карточка рендерится после загрузки — к якорю (ссылка из «Портфеля» и Earn) браузер ещё не прокрутил.
  useEffect(() => {
    if (status && window.location.hash === `#${ACCOUNT_KEY_ANCHOR}`)
      ref.current?.scrollIntoView({ block: "start" });
  }, [status]);

  return (
    <Card id={ACCOUNT_KEY_ANCHOR} ref={ref} className="scroll-mt-4">
      <CardHeader>
        <CardTitle>Основной аккаунт — read-only ключ</CardTitle>
        <CardDescription>
          Ключ только для чтения: «Портфель», сложные продукты Earn и UID
          основного счёта для проверки воркера реального счёта. Сервер проверяет
          права ключа в Binance и хранит его в базе в зашифрованном виде; после
          сохранения сам ключ больше нигде не показывается.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {query.isPending && <p className="text-muted-foreground">Загрузка…</p>}
        {query.error && (
          <p className="text-destructive">{query.error.message}</p>
        )}
        {status && (
          <>
            {status.decryptFailed && stored && (
              <p className="font-medium text-destructive">
                ⚠️ Сохранённый ключ {hintText(stored.hint)} не расшифровывается —
                введите его заново.
              </p>
            )}
            {usable && stored && (
              <div className="flex flex-col gap-2">
                <p className="font-medium text-positive">
                  ✅ Ключ {hintText(stored.hint)}
                </p>
                <p className="text-sm text-muted-foreground">
                  Сохранён {formatDateTime(stored.savedAt)}
                </p>
                <div className="flex flex-col gap-1">
                  <h3 className="text-sm font-semibold">
                    Права на момент проверки
                  </h3>
                  {stored.flags ? (
                    <KeyFlags flags={stored.flags} />
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Права не записаны.
                    </p>
                  )}
                </div>
              </div>
            )}
            <SourceNote status={status} />
            {usable && !replacing ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setReplacing(true)}
                >
                  Заменить ключ
                </Button>
                {stored && <DeleteKey hint={stored.hint} />}
              </div>
            ) : (
              <>
                <Requirements />
                <KeyForm
                  status={status}
                  onDone={() => setReplacing(false)}
                  onCancel={replacing ? () => setReplacing(false) : undefined}
                />
                {!usable && stored && <DeleteKey hint={stored.hint} />}
              </>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
