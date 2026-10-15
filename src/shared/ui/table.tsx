"use client";

import type * as React from "react";
import { type RefObject, useLayoutEffect, useRef } from "react";
import { cn } from "@/shared/lib/utils";
import { fitsWidth, pickTableFit } from "./table-fit";

/**
 * Режим раскладки — в `data-fit` контейнера (spec 0018): `wide` — помещается и с названиями в одну строку,
 * `wrap` — помещается только с переносом названий, без атрибута — не помещается и прокручивается вбок. Названия
 * по умолчанию в одну строку и переносятся только в `wrap` (класс `group-data-[fit=wrap]/table:whitespace-normal`):
 * при прокрутке вбок перенос не нужен (решение 7). Меряется заново при изменении размеров рамки или таблицы.
 */
function useTableFit(ref: RefObject<HTMLDivElement | null>) {
  useLayoutEffect(() => {
    const frame = ref.current;
    const table = frame?.firstElementChild;
    if (!frame || !(table instanceof HTMLTableElement)) return;
    const apply = () => {
      const fit = pickTableFit((mode) => {
        frame.dataset.fit = mode;
        return fitsWidth(
          table.getBoundingClientRect().width,
          frame.clientWidth,
        );
      });
      if (fit === "scroll") delete frame.dataset.fit;
    };
    apply();
    if (typeof ResizeObserver === "undefined") return;
    // Замер — в следующем кадре: смена режима меняет размеры наблюдаемых элементов, и правка раскладки прямо
    // в колбэке дала бы ошибку «ResizeObserver loop…» (её ловит журнал ошибок браузера).
    let raf = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(apply);
    });
    observer.observe(frame);
    observer.observe(table);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [ref]);
}

/**
 * Таблица на всю ширину рамки. Помещается — контейнер `overflow-x: clip`: он не создаёт контейнер прокрутки,
 * поэтому шапка (`sticky` у TableHead) липнет к верху окна, пока видна таблица. Не помещается — прокрутка вбок
 * внутри контейнера, шапка тогда липнет к нему, то есть стоит на месте (решение 3 spec 0018). Обёртка с рамкой
 * вокруг таблицы — `overflow-clip`, не `overflow-*-auto`: контейнер прокрутки снаружи тоже ломает липкую шапку.
 */
function Table({ className, ...props }: React.ComponentProps<"table">) {
  const ref = useRef<HTMLDivElement>(null);
  useTableFit(ref);
  return (
    <div
      ref={ref}
      data-slot="table-container"
      className="group/table relative w-full overflow-x-auto data-fit:overflow-x-clip"
    >
      <table
        data-slot="table"
        className={cn("w-full caption-bottom text-sm", className)}
        {...props}
      />
    </div>
  );
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      // Линию под шапкой рисует тень TableHead: рамка строки при border-collapse не едет за липкой ячейкой.
      className={cn("[&_tr]:border-b-0", className)}
      {...props}
    />
  );
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  );
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
        className,
      )}
      {...props}
    />
  );
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted",
        className,
      )}
      {...props}
    />
  );
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      // Липкая и непрозрачная; заголовок переносится, когда колонке не хватает места (spec 0018).
      className={cn(
        "sticky top-0 z-10 h-10 bg-card px-2 text-left align-middle font-medium text-foreground shadow-[inset_0_-1px_0_var(--color-border)] [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        className,
      )}
      {...props}
    />
  );
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        className,
      )}
      {...props}
    />
  );
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
};
