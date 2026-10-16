"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useId } from "react";
import { Controller, useForm } from "react-hook-form";
import {
  DISABLE_NOTE_MAX,
  DISABLE_REASON_KEYS,
  DISABLE_REASONS,
  type DisableForm,
  disableFormSchema,
  LabSettingsError,
  useSetExperimentEnabled,
} from "@/entities/experiment";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { variantsToConfirm } from "../lib/variantsToConfirm";

/**
 * Окно выключения эксперимента (spec 0046, AC6): категория причины обязательна, текст — до 200 символов.
 * Контрольный с включёнными вариантами — предупреждение со списком и обязательная галочка. Отмена — эксперимент
 * остаётся включённым (тумблер показывает состояние с сервера). Общее для /settings, /experiments и страницы
 * эксперимента (spec 0050).
 */
export function DisableExperimentDialog({
  experiment,
  variants: known,
  onClose,
  onDisabled,
}: {
  experiment: { id: string; name: string };
  /** Включённые варианты этого контрольного — по данным страницы. */
  variants: readonly string[];
  /** Окно закрыто: «Отмена», крестик или после выключения. */
  onClose: () => void;
  /** Сервер выключил эксперимент (вызывается перед onClose). */
  onDisabled?: () => void;
}) {
  const ids = { reason: useId(), note: useId(), confirm: useId() };
  const toggle = useSetExperimentEnabled();
  // Данные страницы устарели и вариант включили в другом месте — сервер ответил 409 со списком.
  const conflict =
    toggle.error instanceof LabSettingsError ? toggle.error.variants : [];
  const variants = variantsToConfirm(known, conflict);
  const form = useForm<DisableForm>({
    resolver: zodResolver(disableFormSchema),
    defaultValues: { note: "", confirmControl: false },
  });
  const reason = form.watch("reason");
  const confirmed = form.watch("confirmControl");
  const note = form.watch("note") ?? "";
  const ready = Boolean(reason) && (variants.length === 0 || confirmed);

  const submit = form.handleSubmit((values) =>
    toggle.mutate(
      {
        id: experiment.id,
        enabled: false,
        reason: values.reason,
        note: values.note || undefined,
        confirmControl: variants.length > 0 ? values.confirmControl : undefined,
      },
      {
        onSuccess: () => {
          onDisabled?.();
          onClose();
        },
      },
    ),
  );

  return (
    <Dialog open onOpenChange={(o) => !o && !toggle.isPending && onClose()}>
      <DialogContent>
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Выключить {experiment.id}?</DialogTitle>
            <DialogDescription>
              {experiment.name}. Новых paper-сделок не будет, открытые дойдут до
              выхода. Причина видна в «Экспериментах» и на странице
              эксперимента.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1 text-sm">
            <label htmlFor={ids.reason}>Причина</label>
            <Controller
              control={form.control}
              name="reason"
              render={({ field }) => (
                <Select
                  value={field.value ?? ""}
                  onValueChange={field.onChange}
                >
                  <SelectTrigger id={ids.reason} className="w-full">
                    <SelectValue placeholder="Выберите категорию" />
                  </SelectTrigger>
                  <SelectContent>
                    {DISABLE_REASON_KEYS.map((k) => (
                      <SelectItem key={k} value={k}>
                        {DISABLE_REASONS[k]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          <div className="flex flex-col gap-1 text-sm">
            <label htmlFor={ids.note}>Коротко — почему (необязательно)</label>
            <Input
              id={ids.note}
              maxLength={DISABLE_NOTE_MAX}
              placeholder="например: минус за две эпохи"
              {...form.register("note")}
            />
            <span className="text-right text-xs text-muted-foreground">
              {note.length} / {DISABLE_NOTE_MAX}
            </span>
          </div>

          {variants.length > 0 && (
            <div className="flex flex-col gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
              <p>
                Это контрольный для{" "}
                <span className="font-mono">{variants.join(", ")}</span> — без
                него варианты не с чем сравнивать.
              </p>
              <Controller
                control={form.control}
                name="confirmControl"
                render={({ field }) => (
                  <label
                    htmlFor={ids.confirm}
                    className="flex items-center gap-2"
                  >
                    <Checkbox
                      id={ids.confirm}
                      checked={field.value}
                      onCheckedChange={(v) => field.onChange(v === true)}
                    />
                    Да, выключить контрольный
                  </label>
                )}
              />
            </div>
          )}

          {/* Ответ 409 уже показан предупреждением с галочкой выше. */}
          {toggle.error && conflict.length === 0 && (
            <p className="text-sm text-destructive">{toggle.error.message}</p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={toggle.isPending}
              onClick={onClose}
            >
              Отмена
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={!ready || toggle.isPending}
            >
              {toggle.isPending ? "Выключаю…" : "Выключить"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
