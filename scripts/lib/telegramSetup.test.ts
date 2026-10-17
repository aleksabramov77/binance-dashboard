import { describe, expect, it } from "vitest";
import { getTelegramConfig } from "@/shared/config/env.server";
import {
  forumProblems,
  ownerWarnings,
  parseSetupArgs,
  planTopics,
  testTradeCards,
  topicEnvLines,
} from "./telegramSetup";

const GROUP = "-1001234567890";
const forum = {
  id: Number(GROUP),
  type: "supergroup",
  title: "Binance",
  isForum: true,
};
const admin = { status: "administrator", canManageTopics: true };

describe("parseSetupArgs", () => {
  it("флаги и сочетания", () => {
    expect(parseSetupArgs([])).toEqual({
      delete: false,
      topics: false,
      test: false,
      testTrade: false,
    });
    expect(parseSetupArgs(["--topics", "--test"])).toEqual({
      delete: false,
      topics: true,
      test: true,
      testTrade: false,
    });
    expect(parseSetupArgs(["--test-trade"])).toMatchObject({
      test: false,
      testTrade: true,
    });
    expect(parseSetupArgs(["--delete", "--test-trade"])).toEqual({
      error: expect.stringMatching(/только отдельно/),
    });
    expect(parseSetupArgs(["--delete"])).toMatchObject({ delete: true });
    expect(parseSetupArgs(["--delete", "--test"])).toEqual({
      error: expect.stringMatching(/только отдельно/),
    });
    expect(parseSetupArgs(["--topic"])).toEqual({
      error: expect.stringMatching(/неизвестные аргументы: --topic/),
    });
  });
});

describe("testTradeCards — пробная карточка сделки (spec 0068, B7)", () => {
  it("цепочка ⏳ → 🟡 → 🟢: тексты как у реальной сделки, пометка «пробное», звук — только у итога", () => {
    const cards = testTradeCards();
    expect(cards.map((c) => c.text.split("\n\n")[0])).toEqual([
      "⏳ 📈 LONG\n<b>BTC/USDT</b> · USDⓈ-M · S98",
      "🟡 📈 LONG\n<b>BTC/USDT</b> · USDⓈ-M · S98",
      "🟢 +$0,84 📈 LONG\n<b>BTC/USDT</b> · USDⓈ-M · S98",
    ]);
    expect(cards[0].binanceUrl).toBe(
      "https://www.binance.com/en/futures/BTCUSDT",
    );
    expect(cards.map((c) => c.urgent)).toEqual([false, false, true]);
    for (const c of cards)
      expect(c.text).toMatch(
        /\n\n<i>🧪 Пробное сообщение: числа вымышленные, сделки нет<\/i>$/,
      );
  });
});

describe("forumProblems — группа с темами и права бота (AC6)", () => {
  it("всё в порядке — пусто; владелец группы — тоже годится", () => {
    expect(forumProblems(GROUP, forum, admin)).toEqual([]);
    expect(
      forumProblems(GROUP, forum, { status: "creator", canManageTopics: true }),
    ).toEqual([]);
  });

  it("личный чат или обычная группа — что включить и где", () => {
    expect(
      forumProblems(
        "42",
        { id: 42, type: "private", title: null, isForum: false },
        { status: "member", canManageTopics: false },
      ),
    ).toEqual([
      expect.stringMatching(/личный чат, а нужна закрытая группа с темами/),
      expect.stringMatching(/бот не администратор/),
    ]);
    expect(forumProblems(GROUP, { ...forum, isForum: false }, admin)).toEqual([
      expect.stringMatching(/не включены темы.*в настройках группы/),
    ]);
  });

  it("админ без права управлять темами", () => {
    expect(
      forumProblems(GROUP, forum, {
        status: "administrator",
        canManageTopics: false,
      }),
    ).toEqual([expect.stringMatching(/нет права управлять темами/)]);
  });
});

describe("planTopics", () => {
  const topics = [
    { category: "trades", title: "💰 Сделки", env: "TELEGRAM_TOPIC_TRADES" },
    { category: "lab", title: "🧪 Лаборатория", env: "TELEGRAM_TOPIC_LAB" },
    { category: "server", title: "🖥 Сервер", env: "TELEGRAM_TOPIC_SERVER" },
  ];

  it("заданные не пересоздаются, недостающие — создать, мусор — исправить руками", () => {
    const plan = planTopics(topics, {
      TELEGRAM_TOPIC_TRADES: " 12 ",
      TELEGRAM_TOPIC_SERVER: "abc",
    });
    expect(plan.existing).toEqual([{ ...topics[0], id: 12 }]);
    expect(plan.missing).toEqual([topics[1]]);
    expect(plan.invalid).toEqual([{ ...topics[2], value: "abc" }]);
  });

  it("строки env для app.env", () => {
    expect(
      topicEnvLines([
        { env: "TELEGRAM_TOPIC_TRADES", id: 12 },
        { env: "TELEGRAM_TOPIC_LAB", id: 14 },
      ]),
    ).toEqual(["TELEGRAM_TOPIC_TRADES=12", "TELEGRAM_TOPIC_LAB=14"]);
  });
});

describe("ownerWarnings", () => {
  const warn = (env: Record<string, string>) => {
    const config = getTelegramConfig({ TELEGRAM_BOT_TOKEN: "t", ...env });
    return config ? ownerWarnings(config) : [];
  };

  it("группа без TELEGRAM_OWNER_ID — предупреждение; личный чат или владелец задан — нет", () => {
    expect(warn({ TELEGRAM_CHAT_ID: GROUP })).toEqual([
      expect.stringMatching(/бот перестанет отвечать на команды в личке/),
    ]);
    expect(warn({ TELEGRAM_CHAT_ID: GROUP, TELEGRAM_OWNER_ID: "42" })).toEqual(
      [],
    );
    expect(warn({ TELEGRAM_CHAT_ID: "42" })).toEqual([]);
    expect(warn({})).toEqual([]);
  });

  it("TELEGRAM_OWNER_ID — id группы: не принят и, значит, владельца нет (ревью PR #105)", () => {
    expect(warn({ TELEGRAM_CHAT_ID: GROUP, TELEGRAM_OWNER_ID: GROUP })).toEqual(
      [
        expect.stringMatching(
          /^TELEGRAM_OWNER_ID \(-1001234567890\) — не id пользователя/,
        ),
        expect.stringMatching(/не задан или не принят/),
      ],
    );
  });
});
