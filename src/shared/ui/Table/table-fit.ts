/** Запас на дробные пиксели: ширина таблицы и рамки при масштабе и дробных отступах отличается на доли пикселя. */
const SUBPIXEL_TOLERANCE_PX = 0.5;

/**
 * Таблица помещается: её ширина не больше видимой ширины контейнера. Помещается — шапка липнет к окну,
 * нет — таблица прокручивается вбок внутри рамки (spec 0022; режим переноса названий из 0018 убран).
 */
export function fitsWidth(tableWidth: number, frameWidth: number): boolean {
  return tableWidth <= frameWidth + SUBPIXEL_TOLERANCE_PX;
}
