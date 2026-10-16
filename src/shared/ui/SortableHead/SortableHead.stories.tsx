import { fn } from "storybook/test";
import { action, callback, flag, select, text } from "#.storybook/controls";
import preview from "#.storybook/preview";
import { axis, StateGrid } from "#.storybook/StateGrid";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "../Table";
import { SortableHead } from "./SortableHead";

// SortableHead — заголовок колонки: живёт только внутри таблицы, поэтому истории рисуют его в шапке Table.

const meta = preview.meta({
  title: "UIKit/SortableHead",
  component: SortableHead,
  args: {
    active: true,
    dir: "desc" as const,
    description: "Изменение цены за последние 24 часа, %",
    children: "Изменение 24ч",
    onSort: fn(),
  },
  argTypes: {
    active: flag({ optional: false }),
    dir: select(["asc", "desc"], { optional: false }),
    description: text,
    children: text,
    className: {
      ...select(["text-right"]),
      description:
        "text-right — колонка справа, меню открывается к правому краю",
    },
    onSort: action,
    onReset: {
      ...callback(fn().mockName("onReset")),
      description:
        "Задан — в меню пункт «Сбросить сортировку» (у активной колонки)",
    },
  },
  render: (args) => (
    <div className="p-6">
      <Table>
        <TableHeader>
          <TableRow>
            <SortableHead {...args} />
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell className={args.className}>+2,14%</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  ),
});

export const Playground = meta.story({ name: "Playground" });

export const States = meta.story({
  name: "Все состояния",
  render: (args) => (
    <StateGrid
      rows={axis(["не активна", "активна"])}
      columns={axis([
        "asc · слева",
        "desc · слева",
        "asc · справа",
        "desc · справа",
      ])}
    >
      {(active, column) => {
        const [dir, side] = column.split(" · ");
        return (
          <Table>
            <TableHeader>
              <TableRow>
                <SortableHead
                  {...args}
                  active={active === "активна"}
                  dir={dir as "asc" | "desc"}
                  className={side === "справа" ? "text-right" : undefined}
                />
              </TableRow>
            </TableHeader>
          </Table>
        );
      }}
    </StateGrid>
  ),
});
