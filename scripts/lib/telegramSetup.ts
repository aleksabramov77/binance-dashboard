// Чистая логика `pnpm telegram:setup` (spec 0021, 0067): аргументы, проверка группы с темами, план тем, строки env и
// предупреждение о владельце. Сеть и печать — scripts/telegram-setup.ts.
import {
  type LiveCardStatus,
  liveCardText,
  liveCardUrgent,
} from "@/entities/live-account";
import type { TelegramChat, TelegramChatMember } from "@/shared/api/telegram";
import {
  isPrivateChatId,
  type TelegramConfig,
  telegramOwnerProblem,
} from "@/shared/config/env.server";

export interface SetupMode {
  /** Снять webhook. */
  delete: boolean;
  /** Проверить группу, создать недостающие темы, напечатать TELEGRAM_TOPIC_*. */
  topics: boolean;
  /** Пробное сообщение в каждую тему. */
  test: boolean;
  /** Пробная карточка сделки в тему «Сделки»: ⏳ → 🟡 → 🟢 с заменой прежней (spec 0068, B7). */
  testTrade: boolean;
}

const FLAGS: ReadonlySet<string> = new Set([
  "--delete",
  "--topics",
  "--test",
  "--test-trade",
]);

export function parseSetupArgs(args: string[]): SetupMode | { error: string } {
  const unknown = args.filter((a) => !FLAGS.has(a));
  if (unknown.length)
    return {
      error: `неизвестные аргументы: ${unknown.join(" ")}. Есть только ${[...FLAGS].join(", ")}`,
    };
  const mode = {
    delete: args.includes("--delete"),
    topics: args.includes("--topics"),
    test: args.includes("--test"),
    testTrade: args.includes("--test-trade"),
  };
  if (mode.delete && (mode.topics || mode.test || mode.testTrade))
    return {
      error: "--delete — только отдельно, без --topics, --test и --test-trade",
    };
  return mode;
}

/**
 * Что не так с чатом уведомлений для тем: нужна супергруппа с темами, бот — админ с правом управлять темами. Пусто —
 * всё в порядке.
 */
export function forumProblems(
  chatId: string,
  chat: TelegramChat,
  bot: TelegramChatMember,
): string[] {
  const problems: string[] = [];
  if (chat.type !== "supergroup")
    problems.push(
      `TELEGRAM_CHAT_ID (${chatId}) — ${chat.type === "private" ? "личный чат" : `чат типа ${chat.type}`}, а нужна закрытая группа с темами: создайте группу, добавьте бота, включите в настройках группы темы и задайте TELEGRAM_CHAT_ID — id группы`,
    );
  else if (!chat.isForum)
    problems.push(
      `в группе «${chat.title ?? chatId}» не включены темы: включите их в настройках группы`,
    );
  if (bot.status !== "creator" && bot.status !== "administrator")
    problems.push(
      "бот не администратор группы: сделайте его администратором с правом управлять темами",
    );
  else if (!bot.canManageTopics)
    problems.push(
      "у бота нет права управлять темами: включите его в правах администратора бота",
    );
  return problems;
}

export interface TopicSpec {
  category: string;
  title: string;
  env: string;
}

export interface TopicPlan {
  /** Уже заданы в env — не пересоздаются. */
  existing: (TopicSpec & { id: number })[];
  /** Создать. */
  missing: TopicSpec[];
  /** Заданы, но не номер темы — исправить руками (иначе появится вторая тема). */
  invalid: (TopicSpec & { value: string })[];
}

export function planTopics(
  topics: readonly TopicSpec[],
  env: Record<string, string | undefined>,
): TopicPlan {
  const plan: TopicPlan = { existing: [], missing: [], invalid: [] };
  for (const topic of topics) {
    const value = env[topic.env]?.trim();
    if (!value) plan.missing.push(topic);
    else if (/^[1-9]\d*$/.test(value))
      plan.existing.push({ ...topic, id: Number(value) });
    else plan.invalid.push({ ...topic, value });
  }
  return plan;
}

/** Строки для /etc/binance/app.env — в порядке категорий. */
export const topicEnvLines = (topics: readonly { env: string; id: number }[]) =>
  topics.map((t) => `${t.env}=${t.id}`);

/**
 * Предупреждения о владельце: TELEGRAM_OWNER_ID не id пользователя (игнорируется) и чат уведомлений — группа, а
 * владельца нет — команды в личке бот перестанет принимать (владелец по умолчанию — только личный TELEGRAM_CHAT_ID).
 */
export function ownerWarnings(config: TelegramConfig): string[] {
  const warnings: string[] = [];
  const problem = telegramOwnerProblem(config);
  if (problem) warnings.push(problem);
  if (config.chatId && !isPrivateChatId(config.chatId) && !config.ownerId)
    warnings.push(
      `TELEGRAM_CHAT_ID (${config.chatId}) — группа, а TELEGRAM_OWNER_ID не задан или не принят: бот перестанет отвечать на команды в личке. Задайте TELEGRAM_OWNER_ID — ваш id в Telegram (прежний TELEGRAM_CHAT_ID личного чата).`,
    );
  return warnings;
}

/** Пометка пробной пары: числа вымышленные, сделки нет. */
const TEST_MARK = "🧪 Пробное сообщение: числа вымышленные, сделки нет";

/** Пробная карточка: текст и звук (как у настоящей сделки с тем же статусом). */
export interface TestTradeCard {
  /** Для журнала и вывода: «⏳ вход исполнен». */
  label: string;
  text: string;
  urgent: boolean;
}

/**
 * Пробная цепочка карточек для темы «Сделки» (spec 0068, B7): ⏳ вход исполнен → 🟡 защищена → 🟢 закрыта в прибыль —
 * той же функцией текста, что у реальных сделок, с вымышленными числами и пометкой «пробное». Каждая следующая
 * заменяет прежнюю (отправить новую, удалить прежнюю).
 */
export function testTradeCards(): TestTradeCard[] {
  const subject = {
    experimentId: "S98",
    symbol: "BTCUSDT",
    market: "usdm" as const,
    direction: "long" as const,
  };
  const entry = {
    notionalUsd: 50,
    raised: "minNotional" as const,
    entryPrice: 80030,
    stopLoss: 78430,
    takeProfit: 83230,
    openedAt: "2026-10-18T10:25:00.000Z",
  };
  const chain: [string, LiveCardStatus][] = [
    ["⏳ вход исполнен", { kind: "filled" }],
    ["🟡 защищена", { kind: "protected" }],
    [
      "🟢 закрыта",
      {
        kind: "closed",
        exit: {
          realizedPnl: 0.84,
          closedBy: "tp",
          exitPrice: 83230,
          feesUsd: 0.05,
          heldMs: (2 * 60 + 15) * 60_000,
          balance: { usd: 512.4, asOf: null },
        },
      },
    ],
  ];
  return chain.map(([label, status]) => ({
    label,
    text: `${liveCardText(subject, entry, status)}\n${TEST_MARK}`,
    urgent: liveCardUrgent(status),
  }));
}
