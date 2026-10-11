"use client";

import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type * as React from "react";
import { cn } from "@/shared/lib/utils";
import { TableHead } from "./table";

/** Заголовок колонки с сортировкой по клику; стрелка — направление активной сортировки. */
function SortableHead({
  active,
  dir,
  onSort,
  className,
  children,
}: {
  active: boolean;
  dir: "asc" | "desc";
  onSort: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  const Arrow = !active ? ArrowUpDown : dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <TableHead
      className={className}
      aria-sort={
        active ? (dir === "asc" ? "ascending" : "descending") : undefined
      }
    >
      <button
        type="button"
        onClick={onSort}
        className={cn(
          "group inline-flex items-center gap-1 hover:text-foreground",
          active && "text-foreground",
        )}
      >
        {children}
        <Arrow
          className={cn(
            "size-3 shrink-0",
            !active && "opacity-0 group-hover:opacity-60",
          )}
          aria-hidden
        />
      </button>
    </TableHead>
  );
}

export { SortableHead };
