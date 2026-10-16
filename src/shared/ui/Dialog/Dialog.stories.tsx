import { useState } from "react";
import { flag, orUndefined, text } from "#.storybook/controls";
import preview from "#.storybook/preview";
import { axis, StateGrid } from "#.storybook/StateGrid";
import { Button } from "../Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./Dialog";

// Dialog — составной: Playground собирает модалку из частей, пустое поле — части нет.

interface Parts {
  /** Управляемое открытие; не задано — открывается кнопкой. */
  open?: boolean;
  modal?: boolean;
  title?: string;
  description?: string;
  body?: string;
  /** Крестик в углу (DialogContent.showCloseButton). */
  showCloseButton?: boolean;
  /** Кнопка Close в подвале (DialogFooter.showCloseButton). */
  footerCloseButton?: boolean;
  confirmLabel?: string;
  className?: string;
  container?: HTMLElement | null;
  /** Кнопка-триггер; в сетке состояний не нужна (служебный, не контрол). */
  withTrigger?: boolean;
}

/** Модалка из частей: пропсы — контролы Playground. */
function DialogExample({
  open,
  modal,
  title,
  description,
  body,
  showCloseButton,
  footerCloseButton,
  confirmLabel,
  className,
  container,
  withTrigger = true,
}: Parts) {
  return (
    <Dialog open={open} modal={modal}>
      {withTrigger && (
        <DialogTrigger asChild>
          <Button variant="outline">Открыть модалку</Button>
        </DialogTrigger>
      )}
      <DialogContent
        className={className}
        showCloseButton={showCloseButton}
        container={container}
      >
        {(title || description) && (
          <DialogHeader>
            {title && <DialogTitle>{title}</DialogTitle>}
            {description && (
              <DialogDescription>{description}</DialogDescription>
            )}
          </DialogHeader>
        )}
        {body && <p className="text-sm text-muted-foreground">{body}</p>}
        <DialogFooter showCloseButton={footerCloseButton}>
          {confirmLabel && (
            <Button variant="destructive">{confirmLabel}</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const meta = preview.meta({
  title: "UIKit/Dialog",
  component: DialogExample,
  args: {
    open: true,
    title: "Выключить автоторговлю?",
    description: "Открыто 5 paper-сделок — их стопы перестанут проверяться.",
    confirmLabel: "Выключить",
  },
  argTypes: {
    open: flag(),
    modal: flag(),
    title: { ...text, description: "DialogTitle; пусто — нет" },
    description: { ...text, description: "DialogDescription; пусто — нет" },
    body: { ...text, description: "Текст под шапкой; пусто — нет" },
    showCloseButton: flag(),
    footerCloseButton: flag(),
    confirmLabel: { ...text, description: "Кнопка в подвале; пусто — нет" },
    className: text,
    container: { table: { disable: true } },
    withTrigger: { table: { disable: true } },
  },
});

export const Playground = meta.story({
  name: "Playground",
  render: (args) => (
    <div className="p-6">
      <DialogExample
        {...args}
        title={orUndefined(args.title)}
        description={orUndefined(args.description)}
        body={orUndefined(args.body)}
        confirmLabel={orUndefined(args.confirmLabel)}
      />
    </div>
  ),
});

const FULL: Parts = {
  title: "Выключить автоторговлю?",
  description: "Открыто 5 paper-сделок — их стопы перестанут проверяться.",
  confirmLabel: "Выключить",
};

const VARIANTS: Record<string, Parts> = {
  "заголовок, описание, действие": FULL,
  "без описания": { ...FULL, description: undefined },
  "с текстом": {
    ...FULL,
    body: "Выходы, пропущенные, пока движок был выключен, догонятся по 1m-свечам.",
  },
  "без крестика": { ...FULL, showCloseButton: false },
  "Close в подвале": {
    ...FULL,
    confirmLabel: undefined,
    footerCloseButton: true,
  },
  "только заголовок": { title: FULL.title },
};

/**
 * Ячейка-рамка: transform делает её контейнером для position: fixed — модалка центрируется в ячейке, а не в окне.
 */
function Frame(props: Parts) {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  return (
    <div
      ref={setEl}
      className="relative h-72 w-[34rem] overflow-hidden rounded-lg border border-dashed [transform:translateZ(0)]"
    >
      {el && (
        <DialogExample
          {...props}
          open
          modal={false}
          container={el}
          withTrigger={false}
        />
      )}
    </div>
  );
}

export const States = meta.story({
  name: "Все состояния",
  render: () => (
    <StateGrid rows={axis(Object.keys(VARIANTS))} columns={axis(["открыта"])}>
      {(variant) => <Frame {...VARIANTS[variant]} />}
    </StateGrid>
  ),
});
