import type {
  ExperimentConfig,
  ExperimentMarket,
} from "@binance-dashboard/trading-core";

// Сравнение настроек контрольного и варианта (spec 0046, AC9): только отличия, «настройка · контрольный · вариант».
// Объекты сравниваются по полям вглубь, массивы — целиком (список монет, направления, окно часов).

export interface ConfigDiffLine {
  /** Путь настройки: market, exit.takeProfit.r, universe.blacklist. */
  path: string;
  /** Значение у контрольного и у варианта текстом; null — поля нет. */
  control: string | null;
  variant: string | null;
}

/** Нет отличий — так и пишется в блоке сравнения. */
export const CONFIG_SAME_TEXT = "настройки совпадают";

type Plain = Record<string, unknown>;

const isPlain = (v: unknown): v is Plain =>
  v !== null && typeof v === "object" && !Array.isArray(v);

function format(value: unknown): string | null {
  if (value === undefined) return null;
  if (Array.isArray(value))
    return value.every((x) => typeof x !== "object" || x === null)
      ? value.map(String).join(", ")
      : JSON.stringify(value);
  if (isPlain(value)) return JSON.stringify(value);
  return String(value);
}

function same(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((x, i) => same(x, b[i]));
  if (isPlain(a) && isPlain(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].every((k) => same(a[k], b[k]));
  }
  return Object.is(a, b);
}

function walk(
  a: unknown,
  b: unknown,
  path: string,
  out: ConfigDiffLine[],
): void {
  if (same(a, b)) return;
  if (isPlain(a) && isPlain(b)) {
    // Порядок — как у контрольного, добавленные вариантом поля — следом.
    const keys = [
      ...Object.keys(a),
      ...Object.keys(b).filter((k) => !(k in a)),
    ];
    for (const key of keys)
      walk(a[key], b[key], path ? `${path}.${key}` : key, out);
    return;
  }
  out.push({ path, control: format(a), variant: format(b) });
}

/** Отличия настроек (`market` и `config`) варианта от контрольного; пустой список — настройки совпадают. */
export function diffExperimentConfig(
  control: { market: ExperimentMarket; config: ExperimentConfig },
  variant: { market: ExperimentMarket; config: ExperimentConfig },
): ConfigDiffLine[] {
  const out: ConfigDiffLine[] = [];
  walk(control.market, variant.market, "market", out);
  walk(control.config, variant.config, "", out);
  return out;
}
