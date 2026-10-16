import { CircleCheck } from "lucide-react";
import { flag, select, text } from "#.storybook/controls";
import preview from "#.storybook/preview";
import { axis, StateGrid } from "#.storybook/StateGrid";
import { Badge } from "./Badge";

const VARIANTS = [
  "default",
  "secondary",
  "outline",
  "ghost",
  "destructive",
  "link",
] as const;

const meta = preview.meta({
  title: "UIKit/Badge",
  component: Badge,
  args: { children: "Активен" },
  argTypes: {
    variant: select(VARIANTS),
    asChild: {
      ...flag(),
      description: "Отрисовать как дочерний элемент (здесь — ссылку <a>)",
    },
    children: text,
    className: text,
  },
});

export const Playground = meta.story({
  name: "Playground",
  render: ({ asChild, children, ...args }) => (
    <div className="p-6">
      {asChild ? (
        <Badge asChild {...args}>
          <a href="#playground">{children}</a>
        </Badge>
      ) : (
        <Badge {...args}>{children}</Badge>
      )}
    </div>
  ),
});

export const States = meta.story({
  name: "Все состояния",
  render: () => (
    <StateGrid
      rows={axis(VARIANTS)}
      columns={axis(["текст", "с иконкой", "ссылка (asChild)"])}
    >
      {(variant, state) =>
        state === "ссылка (asChild)" ? (
          <Badge asChild variant={variant}>
            <a href="#states">Ссылка</a>
          </Badge>
        ) : (
          <Badge variant={variant}>
            {state === "с иконкой" && <CircleCheck aria-hidden />}
            Активен
          </Badge>
        )
      }
    </StateGrid>
  ),
});
