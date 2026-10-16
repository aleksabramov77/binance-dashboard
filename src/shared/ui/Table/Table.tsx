"use client";

import type * as React from "react";
import { type RefObject, useLayoutEffect, useRef } from "react";
import { cn } from "@/shared/lib/utils";
import { fitsWidth } from "./table-fit";

/**
 * Помещается ли таблица в контейнер — атрибут `data-fit` (spec 0022; заменяет режимы `wide`/`wrap` из 0018).
 * Меряется заново при изменении размеров контейнера или таблицы.
 */
function useTableFit(ref: RefObject<HTMLDivElement | null>) {
  useLayoutEffect(() => {
    const frame = ref.current;
    const table = frame?.firstElementChild;
    if (!frame || !(table instanceof HTMLTableElement)) return;
    const apply = () => {
      if (fitsWidth(table.getBoundingClientRect().width, frame.clientWidth))
        frame.dataset.fit = "";
      else delete frame.dataset.fit;
    };
    apply();
    if (typeof ResizeObserver === "undefined") return;
    // Замер — в следующем кадре: смена overflow меняет размеры наблюдаемых элементов, и правка раскладки прямо
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
 * Таблица шириной по содержимому (`w-max`, spec 0022): колонки не сжимаются, заголовки и ячейки — в одну строку.
 * Шире доступного места — контейнер (`max-w-full`) прокручивается вбок, шапка тогда липнет к нему, то есть стоит
 * на месте. Помещается — контейнер `overflow-x: clip`: он не создаёт контейнер прокрутки, поэтому шапка (`sticky`
 * у TableHead) липнет к верху окна, пока видна таблица (spec 0018). Рамка вокруг — `TableFrame` или карточка
 * `w-fit max-w-full`; у неё `overflow-clip`, не `overflow-*-auto`: контейнер прокрутки снаружи тоже ломает липкую шапку.
 */
function Table({ className, ...props }: React.ComponentProps<"table">) {
  const ref = useRef<HTMLDivElement>(null);
  useTableFit(ref);
  return (
    <div
      ref={ref}
      data-slot="table-container"
      className="relative max-w-full overflow-x-auto data-fit:overflow-x-clip"
    >
      <table
        data-slot="table"
        className={cn("w-max caption-bottom text-sm", className)}
        {...props}
      />
    </div>
  );
}

/**
 * Рамка таблицы по ширине содержимого (spec 0022): таблица уже доступного места — граница сразу за последней
 * колонкой; шире — рамка на всю ширину, таблица прокручивается внутри. `min-w-0` — чтобы рамка сужалась в сетке и flex.
 */
function TableFrame({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="table-frame"
      className={cn(
        "w-fit max-w-full min-w-0 overflow-clip rounded-xl border bg-card",
        className,
      )}
      {...props}
    />
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
      // Липкая и непрозрачная (spec 0018); заголовок в одну строку (spec 0022).
      className={cn(
        "sticky top-0 z-10 h-10 bg-card px-2 text-left align-middle font-medium whitespace-nowrap text-foreground shadow-[inset_0_-1px_0_var(--color-border)] [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
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
  TableFrame,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
};
