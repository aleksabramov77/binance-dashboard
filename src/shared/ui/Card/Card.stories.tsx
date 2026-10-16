import { flag, orUndefined, text } from "#.storybook/controls";
import preview from "#.storybook/preview";
import { axis, StateGrid } from "#.storybook/StateGrid";
import { Button } from "../Button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./Card";

// Card — составной компонент: Playground собирает его из частей, пустое поле — части нет.

interface Parts {
  title?: string;
  description?: string;
  action?: boolean;
  content?: string;
  footer?: string;
  footerBorder?: boolean;
  className?: string;
}

/** Карточка из частей: пропсы — контролы Playground. */
function CardExample({
  title,
  description,
  action,
  content,
  footer,
  footerBorder,
  className,
}: Parts) {
  const hasHeader = title || description || action;
  return (
    <Card className={className}>
      {hasHeader && (
        <CardHeader>
          {title && <CardTitle>{title}</CardTitle>}
          {description && <CardDescription>{description}</CardDescription>}
          {action && (
            <CardAction>
              <Button size="sm" variant="outline">
                Обновить
              </Button>
            </CardAction>
          )}
        </CardHeader>
      )}
      {content && <CardContent className="text-sm">{content}</CardContent>}
      {footer && (
        <CardFooter
          className={
            footerBorder
              ? "border-t text-xs text-muted-foreground"
              : "text-xs text-muted-foreground"
          }
        >
          {footer}
        </CardFooter>
      )}
    </Card>
  );
}

const meta = preview.meta({
  title: "UIKit/Card",
  component: CardExample,
  args: {
    title: "Портфель",
    description: "Spot, Earn и фьючерсы в одном месте",
    action: true,
    content: "Итого: 12 345 $",
    footer: "Обновлено 16 окт., 15:30",
    footerBorder: true,
  },
  argTypes: {
    title: { ...text, description: "CardTitle; пусто — нет" },
    description: { ...text, description: "CardDescription; пусто — нет" },
    action: { ...flag(), description: "CardAction (кнопка справа в шапке)" },
    content: { ...text, description: "CardContent; пусто — нет" },
    footer: { ...text, description: "CardFooter; пусто — нет" },
    footerBorder: { ...flag(), description: "Линия над подвалом (border-t)" },
    className: text,
  },
});

export const Playground = meta.story({
  name: "Playground",
  render: (args) => (
    <div className="max-w-md p-6">
      <CardExample
        {...args}
        title={orUndefined(args.title)}
        description={orUndefined(args.description)}
        content={orUndefined(args.content)}
        footer={orUndefined(args.footer)}
      />
    </div>
  ),
});

const FULL: Parts = {
  title: "Портфель",
  description: "Spot, Earn и фьючерсы в одном месте",
  action: true,
  content: "Итого: 12 345 $",
  footer: "Обновлено 16 окт., 15:30",
  footerBorder: true,
};

const VARIANTS: Record<string, Parts> = {
  "все части": FULL,
  "без кнопки": { ...FULL, action: false },
  "только шапка": { title: FULL.title, description: FULL.description },
  "без шапки": { content: FULL.content, footer: FULL.footer },
  "только содержимое": { content: FULL.content },
  "подвал без линии": { ...FULL, footerBorder: false },
};

export const States = meta.story({
  name: "Все состояния",
  render: () => (
    <StateGrid
      rows={axis(Object.keys(VARIANTS))}
      columns={axis(["карточка"])}
      cellClassName="w-96"
    >
      {(variant) => <CardExample {...VARIANTS[variant]} />}
    </StateGrid>
  ),
});
