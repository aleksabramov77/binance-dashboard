/**
 * Режимы раскладки таблицы, в которых она помещается в рамку, — в порядке предпочтения (spec 0018):
 * `wide` — помещается, даже если названия в одну строку; `wrap` — только с переносом названий.
 */
export const TABLE_FITS = ["wide", "wrap"] as const;
export type TableFitMode = (typeof TABLE_FITS)[number];
/** `scroll` — не помещается ни в каком режиме: таблица прокручивается вбок внутри рамки. */
export type TableFit = TableFitMode | "scroll";

/** Таблица помещается: её ширина не больше видимой ширины рамки (запас — на дробные пиксели). */
export function fitsWidth(tableWidth: number, frameWidth: number): boolean {
  return tableWidth <= frameWidth + 0.5;
}

/** Первый режим, в котором таблица помещается, иначе `scroll`. `fits` применяет режим и меряет. */
export function pickTableFit(fits: (mode: TableFitMode) => boolean): TableFit {
  for (const mode of TABLE_FITS) if (fits(mode)) return mode;
  return "scroll";
}
