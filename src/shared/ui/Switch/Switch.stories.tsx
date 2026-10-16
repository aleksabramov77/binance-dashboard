import { fn } from "storybook/test";
import { callback, flag, select, text } from "#.storybook/controls";
import preview from "#.storybook/preview";
import { axis, StateGrid } from "#.storybook/StateGrid";
import { Switch } from "./Switch";

const SIZES = ["default", "sm"] as const;

const meta = preview.meta({
  title: "UIKit/Switch",
  component: Switch,
  args: { "aria-label": "Тумблер" },
  argTypes: {
    size: select(SIZES),
    checked: {
      ...flag(),
      description:
        "Управляемое значение; не задано — тумблер сам помнит состояние",
    },
    defaultChecked: flag(),
    disabled: flag(),
    required: flag(),
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
      <Switch {...args} />
    </div>
  ),
});

export const States = meta.story({
  name: "Все состояния",
  render: () => (
    <StateGrid
      rows={axis(SIZES)}
      columns={axis(["выкл", "вкл", "выкл, недоступен", "вкл, недоступен"])}
    >
      {(size, state) => (
        <Switch
          size={size}
          checked={state.startsWith("вкл")}
          disabled={state.endsWith("недоступен")}
          aria-label={`${size}, ${state}`}
        />
      )}
    </StateGrid>
  ),
});
