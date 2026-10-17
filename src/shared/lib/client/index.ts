// Браузер ↔ сервер: версия сборки страницы и отчёт об ошибках браузера в серверный журнал.
export {
  type AppVersion,
  appVersionSchema,
  getPageVersion,
  isStaleVersion,
} from "./appVersion";
export {
  EXPECTED_ERRORS_META,
  shouldReportMutationError,
} from "./mutationErrors";
export { reportClientError } from "./reportClientError";
