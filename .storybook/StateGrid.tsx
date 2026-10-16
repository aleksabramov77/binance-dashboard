import { Fragment, type ReactNode } from "react";

// Сетка состояний компонента (задача 0051): строки × колонки, у каждой — подпись.

export interface Axis<T> {
  label: string;
  value: T;
}

/** Ось из значений; подпись — само значение или своя. */
export const axis = <const T,>(
  values: readonly T[],
  label: (v: T) => string = String,
): Axis<T>[] => values.map((value) => ({ label: label(value), value }));

export function StateGrid<R, C>({
  rows,
  columns,
  cellClassName,
  children,
}: {
  rows: readonly Axis<R>[];
  columns: readonly Axis<C>[];
  /** Размер ячейки — например, место под открытый поповер. */
  cellClassName?: string;
  children: (row: R, column: C) => ReactNode;
}) {
  return (
    <div className="overflow-x-auto p-6">
      <div
        className="grid items-start gap-x-8 gap-y-6"
        style={{
          gridTemplateColumns: `max-content repeat(${columns.length}, max-content)`,
        }}
      >
        <span />
        {columns.map((c) => (
          <span
            key={c.label}
            className="font-mono text-xs text-muted-foreground"
          >
            {c.label}
          </span>
        ))}
        {rows.map((r) => (
          <Fragment key={r.label}>
            <span className="font-mono text-xs text-muted-foreground">
              {r.label}
            </span>
            {columns.map((c) => (
              <div key={c.label} className={cellClassName}>
                {children(r.value, c.value)}
              </div>
            ))}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

/** Одна строка состояний без подписи строки. */
export const ONE_ROW: Axis<null>[] = [{ label: "", value: null }];
