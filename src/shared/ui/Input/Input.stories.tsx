import { fn } from "storybook/test";
import { callback, flag, number, select, text } from "#.storybook/controls";
import preview from "#.storybook/preview";
import { axis, StateGrid } from "#.storybook/StateGrid";
import { Input } from "./Input";

const TYPES = [
  "text",
  "number",
  "password",
  "email",
  "search",
  "date",
  "file",
] as const;

const meta = preview.meta({
  title: "UIKit/Input",
  component: Input,
  args: { placeholder: "Например, BTCUSDT" },
  argTypes: {
    type: select(TYPES),
    placeholder: text,
    defaultValue: text,
    disabled: flag(),
    readOnly: flag(),
    required: flag(),
    "aria-invalid": flag(),
    min: number,
    max: number,
    step: number,
    className: text,
    onChange: callback(fn().mockName("onChange")),
  },
});

export const Playground = meta.story({
  name: "Playground",
  render: (args) => (
    <div className="max-w-xs p-6">
      <Input {...args} />
    </div>
  ),
});

export const States = meta.story({
  name: "Все состояния",
  render: () => (
    <StateGrid
      rows={axis(["пустое", "заполнено"])}
      columns={axis(["обычное", "недоступно", "только чтение", "ошибка"])}
      cellClassName="w-52"
    >
      {(fill, state) => (
        <Input
          placeholder="Например, BTCUSDT"
          defaultValue={fill === "заполнено" ? "ETHUSDT" : undefined}
          disabled={state === "недоступно"}
          readOnly={state === "только чтение"}
          aria-invalid={state === "ошибка" || undefined}
        />
      )}
    </StateGrid>
  ),
});

export const Types = meta.story({
  name: "Все типы",
  render: () => (
    <StateGrid
      rows={axis(TYPES)}
      columns={axis(["пустое"])}
      cellClassName="w-60"
    >
      {(type) => <Input type={type} placeholder={type} />}
    </StateGrid>
  ),
});
