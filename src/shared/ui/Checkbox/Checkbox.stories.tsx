import { fn } from "storybook/test";
import { callback, EMPTY, flag, text } from "#.storybook/controls";
import preview from "#.storybook/preview";
import { axis, StateGrid } from "#.storybook/StateGrid";
import { Checkbox } from "./Checkbox";

const meta = preview.meta({
  title: "UIKit/Checkbox",
  component: Checkbox,
  args: { "aria-label": "Флажок" },
  argTypes: {
    checked: {
      control: "select",
      options: [EMPTY, true, false, "indeterminate"],
      mapping: { [EMPTY]: undefined },
      description:
        "Управляемое значение; не задано — флажок сам помнит состояние",
    },
    defaultChecked: flag(),
    disabled: flag(),
    required: flag(),
    "aria-invalid": flag(),
    name: text,
    value: text,
    className: text,
    onCheckedChange: callback(fn().mockName("onCheckedChange")),
  },
});

export const Playground = meta.story({
  name: "Playground",
  render: (args) => (
    <div className="p-6">
      <Checkbox {...args} />
    </div>
  ),
});

const VALUES = [false, true, "indeterminate"] as const;

export const States = meta.story({
  name: "Все состояния",
  render: () => (
    <StateGrid
      rows={axis(["обычный", "недоступен", "ошибка"])}
      columns={axis(VALUES, (v) =>
        v === "indeterminate" ? "частично" : v ? "отмечен" : "снят",
      )}
    >
      {(state, checked) => (
        <Checkbox
          checked={checked}
          disabled={state === "недоступен"}
          aria-invalid={state === "ошибка" || undefined}
          aria-label={`${state}, ${String(checked)}`}
        />
      )}
    </StateGrid>
  ),
});
