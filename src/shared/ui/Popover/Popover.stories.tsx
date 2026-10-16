import { flag, number, orUndefined, select, text } from "#.storybook/controls";
import preview from "#.storybook/preview";
import { axis, StateGrid } from "#.storybook/StateGrid";
import { Button } from "../Button";
import { Popover, PopoverContent, PopoverTrigger } from "./Popover";

const SIDES = ["top", "right", "bottom", "left"] as const;
const ALIGNS = ["start", "center", "end"] as const;

interface Parts {
  /** Управляемое открытие; не задано — открывается кнопкой. */
  open?: boolean;
  modal?: boolean;
  side?: (typeof SIDES)[number];
  align?: (typeof ALIGNS)[number];
  sideOffset?: number;
  alignOffset?: number;
  avoidCollisions?: boolean;
  content?: string;
  className?: string;
}

/** Поповер из частей: пропсы — контролы Playground. */
function PopoverExample({ open, modal, content, ...contentProps }: Parts) {
  return (
    <Popover open={open} modal={modal}>
      <PopoverTrigger asChild>
        <Button variant="outline">Счета</Button>
      </PopoverTrigger>
      <PopoverContent {...contentProps}>{content}</PopoverContent>
    </Popover>
  );
}

const meta = preview.meta({
  title: "UIKit/Popover",
  component: PopoverExample,
  args: {
    open: true,
    content: "Таблица счетов по группам активов и ссылка на сбросы.",
  },
  argTypes: {
    open: flag(),
    modal: flag(),
    side: select(SIDES),
    align: select(ALIGNS),
    sideOffset: number,
    alignOffset: number,
    avoidCollisions: flag(),
    content: text,
    className: text,
  },
});

export const Playground = meta.story({
  name: "Playground",
  render: (args) => (
    <div className="flex min-h-96 items-center justify-center p-6">
      <PopoverExample {...args} content={orUndefined(args.content)} />
    </div>
  ),
});

export const States = meta.story({
  name: "Все состояния",
  render: () => (
    <StateGrid
      rows={axis(SIDES)}
      columns={axis(ALIGNS)}
      cellClassName="flex h-56 w-80 items-center justify-center"
    >
      {(side, align) => (
        <PopoverExample
          open
          side={side}
          align={align}
          className="w-40 p-2 text-xs"
          content={`${side} · ${align}`}
        />
      )}
    </StateGrid>
  ),
});
