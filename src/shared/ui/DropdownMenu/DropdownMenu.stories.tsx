import { useState } from "react";
import { flag, number, orUndefined, select, text } from "#.storybook/controls";
import preview from "#.storybook/preview";
import { axis, StateGrid } from "#.storybook/StateGrid";
import { Button } from "../Button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./DropdownMenu";

const SIDES = ["top", "right", "bottom", "left"] as const;
const ALIGNS = ["start", "center", "end"] as const;

interface Parts {
  /** Управляемое открытие; не задано — открывается кнопкой. */
  open?: boolean;
  modal?: boolean;
  side?: (typeof SIDES)[number];
  align?: (typeof ALIGNS)[number];
  sideOffset?: number;
  /** DropdownMenuLabel; пусто — нет. */
  label?: string;
  /** Пункты с галочкой (DropdownMenuCheckboxItem). */
  checkboxItems?: boolean;
  /** Недоступный пункт. */
  disabledItem?: boolean;
  separator?: boolean;
  className?: string;
}

/** Меню из частей: пропсы — контролы Playground. */
function DropdownMenuExample({
  open,
  modal,
  label,
  checkboxItems,
  disabledItem,
  separator,
  ...contentProps
}: Parts) {
  const [sort, setSort] = useState<"asc" | "desc">("desc");
  return (
    <DropdownMenu open={open} modal={modal}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline">Меню</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent {...contentProps}>
        {label && <DropdownMenuLabel>{label}</DropdownMenuLabel>}
        {label && separator && <DropdownMenuSeparator />}
        {checkboxItems ? (
          <>
            <DropdownMenuCheckboxItem
              checked={sort === "asc"}
              onSelect={() => setSort("asc")}
            >
              По возрастанию
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={sort === "desc"}
              onSelect={() => setSort("desc")}
            >
              По убыванию
            </DropdownMenuCheckboxItem>
          </>
        ) : (
          <>
            <DropdownMenuItem>Открыть</DropdownMenuItem>
            <DropdownMenuItem>Переименовать</DropdownMenuItem>
          </>
        )}
        {separator && <DropdownMenuSeparator />}
        <DropdownMenuItem disabled={disabledItem}>
          Удалить{disabledItem ? " (недоступно)" : ""}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const meta = preview.meta({
  title: "UIKit/DropdownMenu",
  component: DropdownMenuExample,
  args: {
    open: true,
    modal: false,
    label: "Сортировка",
    checkboxItems: true,
    separator: true,
  },
  argTypes: {
    open: flag(),
    modal: flag(),
    side: select(SIDES),
    align: select(ALIGNS),
    sideOffset: number,
    label: text,
    checkboxItems: flag(),
    disabledItem: flag(),
    separator: flag(),
    className: text,
  },
});

export const Playground = meta.story({
  name: "Playground",
  render: (args) => (
    <div className="flex min-h-80 items-start justify-center p-6">
      <DropdownMenuExample {...args} label={orUndefined(args.label)} />
    </div>
  ),
});

const VARIANTS: Record<string, Parts> = {
  "простые пункты": {},
  "с заголовком": { label: "Действия", separator: true },
  "с галочками": { label: "Сортировка", checkboxItems: true, separator: true },
  "недоступный пункт": { disabledItem: true, separator: true },
};

export const States = meta.story({
  name: "Все состояния",
  render: () => (
    <StateGrid
      rows={axis(["открыто"])}
      columns={axis(Object.keys(VARIANTS))}
      cellClassName="h-64 w-56"
    >
      {(_, variant) => (
        <DropdownMenuExample
          {...VARIANTS[variant]}
          open
          modal={false}
          align="start"
        />
      )}
    </StateGrid>
  ),
});
