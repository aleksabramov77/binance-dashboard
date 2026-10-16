import { expect, fn, waitFor, within } from "storybook/test";
import { action, callback, flag, select, text } from "#.storybook/controls";
import preview from "#.storybook/preview";
import { axis, StateGrid } from "#.storybook/StateGrid";
import { ConfirmAction } from "./ConfirmAction";

const VARIANTS = ["destructive", "outline", "default"] as const;
const SIZES = ["sm", "default"] as const;

const meta = preview.meta({
  title: "UIKit/ConfirmAction",
  component: ConfirmAction,
  args: {
    label: "Сбросить эпоху",
    title: "Сбросить эпоху лаборатории?",
    description:
      "Бюджеты групп вернутся к стартовым, история сделок останется.",
    confirmLabel: "Сбросить",
    onConfirm: fn(),
  },
  argTypes: {
    label: text,
    title: text,
    description: text,
    children: { ...text, description: "Текст в модалке под описанием" },
    confirmLabel: text,
    pending: flag(),
    error: text,
    variant: select(VARIANTS),
    size: select(SIZES),
    disabled: flag(),
    onConfirm: action,
    onOpen: callback(fn().mockName("onOpen")),
  },
});

export const Playground = meta.story({
  name: "Playground",
  render: (args) => (
    <div className="p-6">
      <ConfirmAction {...args} />
    </div>
  ),
});

export const States = meta.story({
  name: "Все состояния",
  render: (args) => (
    <StateGrid
      rows={axis(VARIANTS)}
      columns={axis(["sm", "default", "sm, недоступна"])}
    >
      {(variant, column) => (
        <ConfirmAction
          {...args}
          variant={variant}
          size={column === "default" ? "default" : "sm"}
          disabled={column.endsWith("недоступна")}
        />
      )}
    </StateGrid>
  ),
});

const openDialog = async ({
  canvas,
  userEvent,
}: {
  canvas: ReturnType<typeof within>;
  userEvent: { click: (el: Element) => Promise<void> };
}) => {
  await userEvent.click(await canvas.findByRole("button"));
  return within(document.body).findByRole("dialog");
};

export const OpenWithError = meta.story({
  name: "Модалка: ошибка",
  args: { error: "Нет связи с базой лаборатории" },
  render: Playground.input.render,
  play: async (context) => {
    const dialog = await openDialog(context);
    await waitFor(() =>
      expect(
        within(dialog).getByText("Нет связи с базой лаборатории"),
      ).toBeVisible(),
    );
  },
});

export const OpenPending = meta.story({
  name: "Модалка: выполняю…",
  args: { pending: true },
  render: Playground.input.render,
  play: async (context) => {
    const dialog = await openDialog(context);
    await waitFor(() =>
      expect(within(dialog).getByText("Выполняю…")).toBeVisible(),
    );
  },
});
