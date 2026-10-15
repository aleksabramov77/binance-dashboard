import { parseAsFloat } from "nuqs";

/**
 * Сумма в $ — один ключ `amount` на всех вкладках /earn (spec 0019). Тот же парсер объявлен в
 * `features/allocation-advice` (фичи друг друга не импортируют): nuqs синхронизирует одинаковые ключи,
 * поэтому значение по умолчанию и тип должны совпадать.
 */
export const amountParser = parseAsFloat.withDefault(1000);
