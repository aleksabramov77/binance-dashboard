// Ожидаемые отказы мутаций (spec 0065): ошибка, которую пользователь видит в форме и которая — не сбой (сервер отклонил
// ввод с причиной и сам пишет warn), не уходит в журнал как error `client` и не будит монитор журнала (spec 0037).
// Решает предикат по самой ошибке: сеть и 5xx той же мутации по-прежнему пишутся.

export type ExpectedErrorPredicate = (error: unknown) => boolean;

/** meta мутации: `useMutation({ meta: expectedErrorsMeta((e) => …), … })`. */
export const expectedErrorsMeta = (
  isExpectedError: ExpectedErrorPredicate,
) => ({
  isExpectedError,
});

/** Общий обработчик ошибок мутаций: писать ли ошибку в серверный журнал. */
export function shouldReportMutationError(
  meta: Record<string, unknown> | undefined,
  error: unknown,
): boolean {
  const predicate = meta?.isExpectedError;
  return !(typeof predicate === "function" && predicate(error) === true);
}
