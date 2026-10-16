"use client";

import type * as React from "react";
import { useState } from "react";
import { Button } from "../Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../Dialog";

/**
 * Кнопка действия с подтверждением в модалке. onConfirm получает close — вызвать после успеха.
 * Ошибку и «идёт запрос» показывает вызывающий через error/pending.
 */
function ConfirmAction({
  label,
  title,
  description,
  children,
  confirmLabel,
  onConfirm,
  onOpen,
  pending = false,
  error,
  variant = "destructive",
  size = "sm",
  disabled,
}: {
  label: React.ReactNode;
  title: string;
  description?: string;
  children?: React.ReactNode;
  confirmLabel: string;
  onConfirm: (close: () => void) => void;
  /** Перед открытием — например, сбросить прошлую ошибку мутации. */
  onOpen?: () => void;
  pending?: boolean;
  error?: string | null;
  variant?: "destructive" | "outline" | "default";
  size?: "sm" | "default";
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <>
      <Button
        variant={variant}
        size={size}
        disabled={disabled}
        onClick={() => {
          onOpen?.();
          setOpen(true);
        }}
      >
        {label}
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && (
              <DialogDescription>{description}</DialogDescription>
            )}
          </DialogHeader>
          {children && (
            <div className="text-sm text-muted-foreground">{children}</div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button variant="outline" disabled={pending} onClick={close}>
              Отмена
            </Button>
            <Button
              variant={variant === "outline" ? "default" : variant}
              disabled={pending}
              onClick={() => onConfirm(close)}
            >
              {pending ? "Выполняю…" : confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export { ConfirmAction };
