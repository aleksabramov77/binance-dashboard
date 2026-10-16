// Контролы Playground (задача 0051): у каждого пропа — все допустимые значения; у необязательного первым пунктом
// идёт «— не задано —», и тогда проп в компонент не передаётся (undefined).

/** Пустое значение необязательного пропа в списке контрола. */
export const EMPTY = "— не задано —";

/** Список из всех значений пропа; необязательный (по умолчанию) — с пустым пунктом. */
export function select<const T extends string | number>(
  options: readonly T[],
  { optional = true }: { optional?: boolean } = {},
) {
  return optional
    ? {
        control: "select" as const,
        options: [EMPTY, ...options],
        mapping: { [EMPTY]: undefined },
      }
    : { control: "select" as const, options: [...options] };
}

/** Флаг: необязательный — «не задано / true / false», обязательный — переключатель. */
export function flag({ optional = true }: { optional?: boolean } = {}) {
  return optional
    ? {
        control: "select" as const,
        options: [EMPTY, true, false],
        mapping: { [EMPTY]: undefined },
      }
    : { control: "boolean" as const };
}

/** Строка; пустое поле у необязательного пропа — не задано (см. orUndefined). */
export const text = { control: "text" as const };

/** Число; пустое поле — не задано. */
export const number = { control: "number" as const };

/** Обязательный колбэк: в контролах не правится, вызовы видны на вкладке Actions. */
export const action = { control: false as const };

/** Необязательный колбэк: «не задано» — не передаётся, «задан» — передаётся handler (вызовы — на вкладке Actions). */
export function callback(handler: (...args: never[]) => unknown) {
  return {
    control: "select" as const,
    options: [EMPTY, "задан"],
    mapping: { [EMPTY]: undefined, задан: handler },
  };
}

/** Пустая строка из текстового контрола — «не задано». */
export const orUndefined = (v: string | undefined) => (v ? v : undefined);
