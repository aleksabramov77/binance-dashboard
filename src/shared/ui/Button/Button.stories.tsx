import { Plus, RefreshCw } from "lucide-react";
import { fn } from "storybook/test";
import { callback, flag, select, text } from "#.storybook/controls";
import preview from "#.storybook/preview";
import { axis, StateGrid } from "#.storybook/StateGrid";
import { Button } from "./Button";

const VARIANTS = [
  "default",
  "secondary",
  "outline",
  "ghost",
  "destructive",
  "link",
] as const;
const SIZES = [
  "xs",
  "sm",
  "default",
  "lg",
  "icon-xs",
  "icon-sm",
  "icon",
  "icon-lg",
] as const;
const meta = preview.meta({
  title: "UIKit/Button",
  component: Button,
  args: { children: "Кнопка" },
  argTypes: {
    variant: select(VARIANTS),
    size: select(SIZES),
    asChild: {
      ...flag(),
      description: "Отрисовать как дочерний элемент (здесь — ссылку <a>)",
    },
    disabled: flag(),
    type: select(["button", "submit", "reset"]),
    children: text,
    className: text,
    onClick: callback(fn().mockName("onClick")),
  },
});

export const Playground = meta.story({
  name: "Playground",
  render: ({ children, asChild, ...args }) => (
    <div className="p-6">
      {asChild ? (
        <Button asChild {...args}>
          <a href="#playground">{children}</a>
        </Button>
      ) : (
        <Button {...args}>{children}</Button>
      )}
    </div>
  ),
});

const STATES = axis(["обычная", "недоступна", "с иконкой", "ссылка (asChild)"]);

export const States = meta.story({
  name: "Все состояния",
  render: () => (
    <div className="flex flex-col gap-2">
      <StateGrid rows={axis(VARIANTS)} columns={STATES}>
        {(variant, state) =>
          state === "ссылка (asChild)" ? (
            <Button asChild variant={variant}>
              <a href="#states">Ссылка</a>
            </Button>
          ) : (
            <Button variant={variant} disabled={state === "недоступна"}>
              {state === "с иконкой" && <Plus aria-hidden />}
              Кнопка
            </Button>
          )
        }
      </StateGrid>
      <StateGrid
        rows={axis(["outline", "default"] as const)}
        columns={axis(SIZES)}
      >
        {(variant, size) => (
          <Button variant={variant} size={size} aria-label={size}>
            {size.startsWith("icon") ? <RefreshCw aria-hidden /> : size}
          </Button>
        )}
      </StateGrid>
    </div>
  ),
});
