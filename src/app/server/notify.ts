// Уведомления приложения (spec 0067): категории, их темы в закрытой группе Telegram и каналы. Место вызова пишет
// `await log.notify({ …, category, urgent })`; куда и как слать, решает канал, подключённый при старте
// (instrumentation.ts → setNotifyChannels). Категории и звук — таблица «Категории и звук» spec 0067.
import {
  createTelegramChannel,
  type TelegramTopicPolicy,
} from "@/shared/api/telegram";
import {
  getTelegramConfig,
  getTelegramTopicId,
} from "@/shared/config/env.server";
import type { NotifyCategory, NotifyChannel } from "@/shared/notify";

// Категории для компилятора: log.notify принимает только их (shared о названиях не знает).
declare module "@/shared/notify" {
  interface NotifyCategories {
    /** 💰 Сделки — реальный счёт. */
    trades: true;
    /** 🧪 Лаборатория — тумблер «Автоторговля», авто-зеркало демо. */
    lab: true;
    /** 🖥 Сервер — сторож, воркер реального счёта, место в базе. */
    server: true;
    /** 🚨 Ошибки — тревоги монитора журнала. */
    errors: true;
  }
}

/** Тема категории: название (так её создаёт `pnpm telegram:setup --topics`) и env-переменная с её номером. */
export interface NotifyTopic {
  title: string;
  env: string;
}

export const NOTIFY_TOPICS = {
  trades: { title: "💰 Сделки", env: "TELEGRAM_TOPIC_TRADES" },
  lab: { title: "🧪 Лаборатория", env: "TELEGRAM_TOPIC_LAB" },
  server: { title: "🖥 Сервер", env: "TELEGRAM_TOPIC_SERVER" },
  errors: { title: "🚨 Ошибки", env: "TELEGRAM_TOPIC_ERRORS" },
} as const satisfies Record<NotifyCategory, NotifyTopic>;

export const NOTIFY_CATEGORIES = Object.keys(NOTIFY_TOPICS) as NotifyCategory[];

/**
 * Политика категории — единственный источник темы, звука и «включена ли» для канала. Сейчас: тема — из env
 * (TELEGRAM_TOPIC_*), звук — только у срочного, все категории включены. Ручные настройки из базы (бот Telegram и
 * /settings, очередь PRD 5a, строка 29) подставляются здесь — без правок мест вызова.
 */
export function notifyPolicy(
  category: NotifyCategory,
  env: Record<string, string | undefined> = process.env,
): TelegramTopicPolicy {
  const topic = NOTIFY_TOPICS[category];
  return {
    title: topic.title,
    topicId: getTelegramTopicId(topic.env, env),
    enabled: true,
    sound: "urgent",
  };
}

/** Каналы уведомлений приложения: сейчас один — Telegram. Новый канал — ещё один элемент списка. */
export function createNotifyChannels(): NotifyChannel[] {
  return [
    createTelegramChannel({
      config: () => getTelegramConfig(),
      policy: (category) => notifyPolicy(category),
    }),
  ];
}
