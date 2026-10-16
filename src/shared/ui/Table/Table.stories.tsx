import { flag, orUndefined, select, text } from "#.storybook/controls";
import preview from "#.storybook/preview";
import { axis, StateGrid } from "#.storybook/StateGrid";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableFrame,
  TableHead,
  TableHeader,
  TableRow,
} from "./Table";

const COLUMNS = [
  "Символ",
  "Цена",
  "Изменение 24ч",
  "Объём",
  "Группа",
  "Стратегия",
  "Открыто",
];
const ROWS = [
  [
    "BTCUSDT",
    "67 210 $",
    "+2,14%",
    "1,2 млрд $",
    "SPOT",
    "RSI2",
    "16 окт., 12:10",
  ],
  [
    "ETHUSDT",
    "2 604 $",
    "-0,87%",
    "540 млн $",
    "FT:USDM",
    "S15",
    "16 окт., 12:42",
  ],
  [
    "SOLUSDT",
    "152,30 $",
    "+5,02%",
    "310 млн $",
    "SPOT",
    "S04",
    "16 окт., 13:05",
  ],
  [
    "BNBUSDT",
    "590,10 $",
    "0,00%",
    "120 млн $",
    "FT:COINM",
    "RSI2",
    "16 окт., 14:20",
  ],
  [
    "LUMIAUSDT",
    "1,84 $",
    "+12,40%",
    "45 млн $",
    "FT:USDM",
    "S15",
    "16 окт., 14:55",
  ],
];

interface Parts {
  /** Строк в теле. */
  rows?: number;
  /** Колонок (2–7): много колонок в узкой рамке — таблица прокручивается вбок. */
  columns?: number;
  /** Рамка TableFrame вокруг таблицы. */
  frame?: boolean;
  /** Итоговая строка (TableFooter). */
  footer?: boolean;
  /** Подпись (TableCaption); пусто — нет. */
  caption?: string;
  /** Ширина места под таблицу. */
  width?: "auto" | "320px" | "480px";
  /** Выделенная строка (data-state=selected). */
  selectedRow?: boolean;
  className?: string;
}

/** Таблица из частей: пропсы — контролы Playground. */
function TableExample({
  rows = 3,
  columns = 4,
  frame,
  footer,
  caption,
  width,
  selectedRow,
  className,
}: Parts) {
  const cols = COLUMNS.slice(0, Math.min(Math.max(columns, 2), COLUMNS.length));
  const table = (
    <Table className={className}>
      {caption && <TableCaption>{caption}</TableCaption>}
      <TableHeader>
        <TableRow>
          {cols.map((c, i) => (
            <TableHead key={c} className={i > 0 ? "text-right" : undefined}>
              {c}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody className="font-mono text-xs tabular-nums">
        {ROWS.slice(0, Math.max(rows, 0)).map((row, r) => (
          <TableRow
            key={row[0]}
            data-state={selectedRow && r === 0 ? "selected" : undefined}
          >
            {cols.map((c, i) => (
              <TableCell key={c} className={i > 0 ? "text-right" : "font-sans"}>
                {row[i]}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
      {footer && (
        <TableFooter>
          <TableRow>
            <TableCell>Итого</TableCell>
            <TableCell colSpan={cols.length - 1} className="text-right">
              {Math.max(rows, 0)} шт.
            </TableCell>
          </TableRow>
        </TableFooter>
      )}
    </Table>
  );
  return (
    <div style={{ width: width && width !== "auto" ? width : undefined }}>
      {frame ? <TableFrame>{table}</TableFrame> : table}
    </div>
  );
}

const meta = preview.meta({
  title: "UIKit/Table",
  component: TableExample,
  args: { rows: 3, columns: 4, frame: true },
  argTypes: {
    rows: { control: { type: "range", min: 0, max: ROWS.length } },
    columns: { control: { type: "range", min: 2, max: COLUMNS.length } },
    frame: flag(),
    footer: flag(),
    caption: text,
    width: select(["auto", "320px", "480px"]),
    selectedRow: flag(),
    className: text,
  },
});

export const Playground = meta.story({
  name: "Playground",
  render: (args) => (
    <div className="p-6">
      <TableExample {...args} caption={orUndefined(args.caption)} />
    </div>
  ),
});

export const States = meta.story({
  name: "Все состояния",
  render: () => (
    <StateGrid
      rows={axis(["в рамке", "без рамки"])}
      columns={axis([
        "помещается",
        "с итогом и подписью",
        "выделена строка",
        "не помещается (320px)",
        "пустая",
      ])}
    >
      {(frame, state) => (
        <TableExample
          frame={frame === "в рамке"}
          rows={state === "пустая" ? 0 : 3}
          columns={state.startsWith("не помещается") ? 7 : 3}
          width={state.startsWith("не помещается") ? "320px" : undefined}
          footer={state === "с итогом и подписью"}
          caption={
            state === "с итогом и подписью"
              ? "Цены Binance, 16 окт."
              : undefined
          }
          selectedRow={state === "выделена строка"}
        />
      )}
    </StateGrid>
  ),
});

export const LongTable = meta.story({
  name: "Липкая шапка",
  render: () => (
    <div className="h-64 overflow-y-auto p-6">
      <TableFrame>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Символ</TableHead>
              <TableHead className="text-right">Цена</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: 30 }, (_, i) => (
              <TableRow key={`row-${i + 1}`}>
                <TableCell>COIN{i + 1}USDT</TableCell>
                <TableCell className="text-right font-mono">
                  {(i + 1) * 10} $
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableFrame>
    </div>
  ),
});
