/**
 * Варианты для предупреждения в окне выключения контрольного (spec 0046, 0050): известные странице, а если она о них
 * не знала (данные устарели) — из ответа сервера 409. Пустой список — предупреждения и галочки нет.
 */
export function variantsToConfirm(
  known: readonly string[],
  fromServer: readonly string[],
): string[] {
  return [...(known.length > 0 ? known : fromServer)];
}
