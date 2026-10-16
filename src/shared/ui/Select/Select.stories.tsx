import { flag, orUndefined, select, text } from "#.storybook/controls";
import preview from "#.storybook/preview";
import { axis, StateGrid } from "#.storybook/StateGrid";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "./Select";

const GROUPS = { spot: "Spot", usdm: "USDⓈ-M", coinm: "COIN-M" } as const;
type Group = keyof typeof GROUPS;
const VALUES = Object.keys(GROUPS) as Group[];

interface Parts {
  /** Управляемое открытие; не задано — открывается кликом. */
  open?: boolean;
  /** Выбранное значение; не задано — плейсхолдер. */
  value?: Group;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  /** Ошибка (aria-invalid на триггере). */
  invalid?: boolean;
  size?: "sm" | "default";
  position?: "item-aligned" | "popper";
  /** Подписи групп и разделитель (SelectLabel, SelectSeparator). */
  grouped?: boolean;
  /** Недоступный пункт COIN-M. */
  disabledItem?: boolean;
  className?: string;
}

/** Список из частей: пропсы — контролы Playground. */
function SelectExample({
  open,
  value,
  placeholder,
  disabled,
  required,
  invalid,
  size,
  position,
  grouped,
  disabledItem,
  className,
}: Parts) {
  const items = VALUES.map((v) => (
    <SelectItem key={v} value={v} disabled={disabledItem && v === "coinm"}>
      {GROUPS[v]}
    </SelectItem>
  ));
  return (
    <Select open={open} value={value} disabled={disabled} required={required}>
      <SelectTrigger
        size={size}
        aria-invalid={invalid || undefined}
        aria-label="Группа активов"
        className={className ?? "w-44"}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent position={position}>
        {grouped ? (
          <>
            <SelectGroup>
              <SelectLabel>Спот</SelectLabel>
              {items[0]}
            </SelectGroup>
            <SelectSeparator />
            <SelectGroup>
              <SelectLabel>Фьючерсы</SelectLabel>
              {items.slice(1)}
            </SelectGroup>
          </>
        ) : (
          items
        )}
      </SelectContent>
    </Select>
  );
}

const meta = preview.meta({
  title: "UIKit/Select",
  component: SelectExample,
  args: { placeholder: "Группа активов" },
  argTypes: {
    open: flag(),
    value: select(VALUES),
    placeholder: text,
    disabled: flag(),
    required: flag(),
    invalid: flag(),
    size: select(["sm", "default"]),
    position: select(["item-aligned", "popper"]),
    grouped: flag(),
    disabledItem: flag(),
    className: text,
  },
});

export const Playground = meta.story({
  name: "Playground",
  render: (args) => (
    <div className="min-h-72 p-6">
      <SelectExample {...args} placeholder={orUndefined(args.placeholder)} />
    </div>
  ),
});

const STATES: Record<string, Parts> = {
  плейсхолдер: {},
  выбрано: { value: "usdm" },
  недоступен: { value: "spot", disabled: true },
  ошибка: { invalid: true },
};

export const States = meta.story({
  name: "Все состояния",
  render: () => (
    <div className="flex flex-col">
      <StateGrid
        rows={axis(["default", "sm"] as const)}
        columns={axis(Object.keys(STATES))}
      >
        {(size, state) => (
          <SelectExample
            {...STATES[state]}
            size={size}
            placeholder="Группа активов"
          />
        )}
      </StateGrid>
      <StateGrid
        rows={axis(["открыт"])}
        columns={axis(["простой список", "группы и недоступный пункт"])}
        cellClassName="h-56 w-56"
      >
        {(_, variant) => (
          <SelectExample
            open
            value="usdm"
            position="popper"
            grouped={variant !== "простой список"}
            disabledItem={variant !== "простой список"}
          />
        )}
      </StateGrid>
    </div>
  ),
});
