import { flag, number, orUndefined, select, text } from "#.storybook/controls";
import preview from "#.storybook/preview";
import { axis, StateGrid } from "#.storybook/StateGrid";
import { Button } from "../Button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./Tooltip";

const SIDES = ["top", "right", "bottom", "left"] as const;
const ALIGNS = ["start", "center", "end"] as const;

interface Parts {
  /** Управляемое открытие; не задано — по наведению. */
  open?: boolean;
  /** Задержка перед показом, мс (TooltipProvider). */
  delayDuration?: number;
  side?: (typeof SIDES)[number];
  align?: (typeof ALIGNS)[number];
  sideOffset?: number;
  content?: string;
  className?: string;
}

/** Подсказка из частей: пропсы — контролы Playground. */
function TooltipExample({
  open,
  delayDuration,
  content,
  ...contentProps
}: Parts) {
  return (
    <TooltipProvider delayDuration={delayDuration}>
      <Tooltip open={open}>
        <TooltipTrigger asChild>
          <Button variant="outline">Наведите</Button>
        </TooltipTrigger>
        <TooltipContent {...contentProps}>{content}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

const meta = preview.meta({
  title: "UIKit/Tooltip",
  component: TooltipExample,
  args: { open: true, content: "Paper — симуляция лаборатории" },
  argTypes: {
    open: flag(),
    delayDuration: number,
    side: select(SIDES),
    align: select(ALIGNS),
    sideOffset: number,
    content: text,
    className: text,
  },
});

export const Playground = meta.story({
  name: "Playground",
  render: (args) => (
    <div className="flex min-h-64 items-center justify-center p-6">
      <TooltipExample {...args} content={orUndefined(args.content)} />
    </div>
  ),
});

export const States = meta.story({
  name: "Все состояния",
  render: () => (
    <StateGrid
      rows={axis(SIDES)}
      columns={axis(ALIGNS)}
      cellClassName="flex h-32 w-64 items-center justify-center"
    >
      {(side, align) => (
        <TooltipExample
          open
          side={side}
          align={align}
          content={`${side} · ${align}`}
        />
      )}
    </StateGrid>
  ),
});
