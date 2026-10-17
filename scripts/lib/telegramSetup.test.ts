import { describe, expect, it } from "vitest";
import {
  forumProblems,
  ownerWarning,
  parseSetupArgs,
  planTopics,
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
    });
    expect(parseSetupArgs(["--topics", "--test"])).toEqual({
      delete: false,
      topics: true,
      test: true,
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

describe("ownerWarning", () => {
  it("группа без TELEGRAM_OWNER_ID — предупреждение; личный чат или владелец задан — нет", () => {
    expect(ownerWarning({ TELEGRAM_CHAT_ID: GROUP })).toMatch(
      /бот перестанет отвечать на команды в личке/,
    );
    expect(
      ownerWarning({ TELEGRAM_CHAT_ID: GROUP, TELEGRAM_OWNER_ID: "42" }),
    ).toBeNull();
    expect(ownerWarning({ TELEGRAM_CHAT_ID: "42" })).toBeNull();
    expect(ownerWarning({})).toBeNull();
  });
});
