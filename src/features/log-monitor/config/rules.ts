/** Пороги монитора логов (платформа). Меняются здесь — без правки логики. */
export const MONITOR = {
  /** Окно проверки = интервал pg_cron. */
  windowMs: 15 * 60_000,
  /** С чем сравниваем окно: средний уровень ошибок за сутки. */
  baselineMs: 24 * 60 * 60_000,
  /** Всплеск ошибок события: не меньше стольких за окно… */
  errorBurst: 5,
  /** …и во столько раз выше обычного (среднего за сутки на одно окно). */
  errorBurstFactor: 3,
  /** Ответов 5xx одной ручки за окно — уже поломка. */
  http5xxPerPath: 3,
  /** Движок включён, а последний тик старше — не тикает. */
  engineStaleMs: 5 * 60_000,
  /** Снимок Earn старше (расписание — дважды в сутки). */
  earnStaleMs: 13 * 60 * 60_000,
  /** Повторять уведомление о незакрытой проблеме не чаще. */
  repeatMs: 2 * 60 * 60_000,
  /** Сколько свежих записей журнала отдать ИИ для разбора. */
  samples: 15,
} as const;
export type MonitorRules = typeof MONITOR;

/** Задачи по тревогам в приватном репозитории GitHub (spec 0037). */
export const ALERT_ISSUES = {
  /** За какое окно считаем автозапуски Claude для лимита ALERT_AUTOFIX_PER_DAY. */
  autofixWindowMs: 24 * 60 * 60_000,
  labels: {
    /** Метка запускает routine Claude (webhook-триггер issues.labeled). */
    autofix: {
      name: "alert",
      color: "d73a4a",
      description: "Тревога монитора: Claude разбирает",
    },
    queued: {
      name: "alert-queued",
      color: "fbca04",
      description:
        "Сверх лимита автозапусков: смените на alert, чтобы запустить",
    },
    noCode: {
      name: "alert-no-code",
      color: "c5def5",
      description: "Разбор Claude: не баг в коде",
    },
    pr: {
      name: "alert-pr",
      color: "0e8a16",
      description: "Разбор Claude: готов draft PR",
    },
  },
} as const;
