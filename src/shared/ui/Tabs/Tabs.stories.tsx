import { fn } from "storybook/test";
import { callback, flag, select, text } from "#.storybook/controls";
import preview from "#.storybook/preview";
import { axis, StateGrid } from "#.storybook/StateGrid";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./Tabs";

const TABS = { spot: "Spot", usdm: "USDⓈ-M", coinm: "COIN-M" } as const;
type Tab = keyof typeof TABS;
const KEYS = Object.keys(TABS) as Tab[];
const ORIENTATIONS = ["horizontal", "vertical"] as const;
const VARIANTS = ["default", "line"] as const;

interface Parts {
  orientation?: (typeof ORIENTATIONS)[number];
  /** Вариант списка вкладок (TabsList.variant). */
  variant?: (typeof VARIANTS)[number];
  /** Управляемая активная вкладка; не задано — помнит сама, с первой. */
  value?: Tab;
  onValueChange?: (value: string) => void;
  /** Недоступная вкладка COIN-M. */
  disabledTab?: boolean;
  activationMode?: "automatic" | "manual";
  className?: string;
}

/** Вкладки из частей: пропсы — контролы Playground. */
function TabsExample({ variant, disabledTab, value, ...rest }: Parts) {
  return (
    <Tabs {...rest} value={value} defaultValue={value ? undefined : "spot"}>
      <TabsList variant={variant}>
        {KEYS.map((k) => (
          <TabsTrigger
            key={k}
            value={k}
            disabled={disabledTab && k === "coinm"}
          >
            {TABS[k]}
          </TabsTrigger>
        ))}
      </TabsList>
      {KEYS.map((k) => (
        <TabsContent
          key={k}
          value={k}
          className="p-2 text-sm text-muted-foreground"
        >
          Эксперименты группы {TABS[k]}
        </TabsContent>
      ))}
    </Tabs>
  );
}

const meta = preview.meta({
  title: "UIKit/Tabs",
  component: TabsExample,
  argTypes: {
    orientation: select(ORIENTATIONS),
    variant: select(VARIANTS),
    value: select(KEYS),
    onValueChange: callback(fn().mockName("onValueChange")),
    disabledTab: flag(),
    activationMode: select(["automatic", "manual"]),
    className: text,
  },
});

export const Playground = meta.story({
  name: "Playground",
  render: (args) => (
    <div className="p-6">
      <TabsExample {...args} />
    </div>
  ),
});

export const States = meta.story({
  name: "Все состояния",
  render: () => (
    <StateGrid
      rows={axis(ORIENTATIONS)}
      columns={axis([
        "default",
        "line",
        "default, недоступная",
        "line, недоступная",
      ])}
    >
      {(orientation, column) => (
        <TabsExample
          orientation={orientation}
          variant={column.startsWith("line") ? "line" : "default"}
          disabledTab={column.endsWith("недоступная")}
          value="usdm"
        />
      )}
    </StateGrid>
  ),
});
