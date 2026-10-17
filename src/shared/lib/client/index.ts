// Браузер ↔ сервер: версия сборки страницы и отчёт об ошибках браузера в серверный журнал.
export {
  type AppVersion,
  appVersionSchema,
  getPageVersion,
  isStaleVersion,
} from "./appVersion";
export {
  type ExpectedErrorPredicate,
  expectedErrorsMeta,
  shouldReportMutationError,
} from "./mutationErrors";
export { reportClientError } from "./reportClientError";
