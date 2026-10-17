// Ожидаемые отказы мутаций (spec 0065): ошибка, которую пользователь видит в форме и которая — не сбой (сервер отклонил
// ввод с причиной, сам пишет warn), не уходит в журнал как error `client` и не будит монитор журнала (spec 0037).

/** meta мутации с ожидаемыми отказами: `useMutation({ meta: EXPECTED_ERRORS_META, … })`. */
export const EXPECTED_ERRORS_META = { expectedErrors: true } as const;

/** Общий обработчик ошибок мутаций: писать ли ошибку в серверный журнал. */
export const shouldReportMutationError = (
  meta: Record<string, unknown> | undefined,
): boolean => meta?.expectedErrors !== true;
