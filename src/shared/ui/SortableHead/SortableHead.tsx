"use client";

import { ArrowDown, ArrowUp, ChevronDown, X } from "lucide-react";
import type * as React from "react";
import { cn } from "@/shared/lib/utils";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../DropdownMenu";
import { TableHead } from "../Table";

type Dir = "asc" | "desc";

/**
 * Заголовок колонки с выпадающим меню: описание колонки и сортировка (по возрастанию/убыванию,
 * сброс). Стрелка рядом с названием — направление активной сортировки.
 */
function SortableHead({
  active,
  dir,
  onSort,
  onReset,
  description,
  className,
  children,
}: {
  active: boolean;
  dir: Dir;
  onSort: (dir: Dir) => void;
  /** Вернуть порядок по умолчанию; нет — пункта «Сбросить» в меню нет. */
  onReset?: () => void;
  /** Что показывает колонка — простыми словами. */
  description: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  const Arrow = dir === "asc" ? ArrowUp : ArrowDown;
  const right = className?.includes("text-right");
  return (
    <TableHead
      className={className}
      aria-sort={
        active ? (dir === "asc" ? "ascending" : "descending") : undefined
      }
    >
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              "group inline-flex items-center gap-1 rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 data-[state=open]:text-foreground",
              active && "text-foreground",
            )}
          >
            {children}
            {active ? (
              <Arrow className="size-3 shrink-0" aria-hidden />
            ) : (
              <ChevronDown
                className="size-3 shrink-0 opacity-40 group-hover:opacity-80"
                aria-hidden
              />
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align={right ? "end" : "start"}
          className="w-72 font-normal"
        >
          <DropdownMenuLabel>{children}</DropdownMenuLabel>
          <p className="px-2 pb-2 text-xs whitespace-normal text-muted-foreground">
            {description}
          </p>
          <DropdownMenuSeparator />
          <DropdownMenuCheckboxItem
            checked={active && dir === "asc"}
            onSelect={() => onSort("asc")}
          >
            <ArrowUp className="text-muted-foreground" aria-hidden />
            По возрастанию
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem
            checked={active && dir === "desc"}
            onSelect={() => onSort("desc")}
          >
            <ArrowDown className="text-muted-foreground" aria-hidden />
            По убыванию
          </DropdownMenuCheckboxItem>
          {onReset && active && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onReset}>
                <X aria-hidden />
                Сбросить сортировку
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </TableHead>
  );
}

export { SortableHead };
