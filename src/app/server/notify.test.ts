import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { log, setNotifyChannels } from "@/shared/lib/logger.server";
import {
  createNotifyChannels,
  NOTIFY_CATEGORIES,
  NOTIFY_TOPICS,
  notifyPolicy,
} from "./notify";

// Категории и темы приложения (spec 0067): политика — таблица «Категории и звук» и env; каналы приложения — от вызова
// логгера до запроса Bot API. Сети нет: fetch подменён.
describe("notifyPolicy", () => {
  it("четыре категории и их темы — как в таблице spec", () => {
    expect(NOTIFY_CATEGORIES).toEqual(["trades", "lab", "server", "errors"]);
    expect(Object.values(NOTIFY_TOPICS).map((t) => [t.title, t.env])).toEqual([
      ["💰 Сделки", "TELEGRAM_TOPIC_TRADES"],
      ["🧪 Лаборатория", "TELEGRAM_TOPIC_LAB"],
      ["🖥 Сервер", "TELEGRAM_TOPIC_SERVER"],
      ["🚨 Ошибки", "TELEGRAM_TOPIC_ERRORS"],
    ]);
  });

  it("тема — из TELEGRAM_TOPIC_*, звук — только у срочного, категория включена", () => {
    expect(notifyPolicy("lab", { TELEGRAM_TOPIC_LAB: "14" })).toEqual({
      title: "🧪 Лаборатория",
      topicId: 14,
      enabled: true,
      sound: "urgent",
    });
    expect(notifyPolicy("errors", {}).topicId).toBeNull();
  });
});

describe("каналы приложения: log.notify → Bot API", () => {
  let bodies: Record<string, unknown>[];
  let methods: string[];
  beforeEach(() => {
    bodies = [];
    methods = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        bodies.push(body);
        methods.push(String(url).split("/").at(-1) ?? "");
        // sendMessage — номер нового сообщения (100 + порядковый); ответ — с reply_to_message.
        return new Response(
          JSON.stringify({
            ok: true,
            result: {
              message_id: 100 + bodies.length,
              ...(body.reply_parameters && {
                reply_to_message: {
                  message_id: body.reply_parameters.message_id,
                },
              }),
            },
          }),
        );
      }),
    );
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_HOST", "vm");
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "bot");
    vi.stubEnv("TELEGRAM_CHAT_ID", "-1001234");
    for (const t of Object.values(NOTIFY_TOPICS)) vi.stubEnv(t.env, "");
    setNotifyChannels(createNotifyChannels());
  });
  afterEach(() => {
    setNotifyChannels([]);
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("срочное «Сделки» — в свою тему со звуком; рутина «Лаборатории» — в свою тему тихо", async () => {
    vi.stubEnv("TELEGRAM_TOPIC_TRADES", "12");
    vi.stubEnv("TELEGRAM_TOPIC_LAB", "14");
    const r = await log.notify({
      level: "error",
      event: "live.unprotected",
      message: "⚠️ без защиты",
      category: "trades",
      urgent: true,
      text: "Binance Dashboard · ⚠️ без защиты",
      link: "https://binance.example.test/settings#live",
    });
    await log.notify({
      level: "info",
      event: "engine.toggle",
      message: "Автоторговля включена",
      category: "lab",
      text: "▶️ Автоторговля включена",
    });
    expect(bodies).toEqual([
      {
        chat_id: "-1001234",
        message_thread_id: 12,
        text: "Binance Dashboard · ⚠️ без защиты\nhttps://binance.example.test/settings#live",
        link_preview_options: { is_disabled: true },
      },
      {
        chat_id: "-1001234",
        message_thread_id: 14,
        text: "▶️ Автоторговля включена",
        disable_notification: true,
        link_preview_options: { is_disabled: true },
      },
    ]);
    expect(r).toEqual({
      category: "trades",
      urgent: true,
      status: "sent",
      channels: [
        {
          channel: "telegram",
          status: "sent",
          target: {
            topic: "💰 Сделки",
            topicId: 12,
            to: "-1001234",
            silent: false,
          },
        },
      ],
      ref: {
        telegram: {
          chatId: "-1001234",
          messageId: 101,
          text: "Binance Dashboard · ⚠️ без защиты\nhttps://binance.example.test/settings#live",
        },
      },
    });
  });

  it("итог сделки — ответ на вход, правка входа и реакция через Bot API (spec 0068)", async () => {
    vi.stubEnv("TELEGRAM_TOPIC_TRADES", "12");
    const entry = await log.notify({
      level: "info",
      event: "live.entry",
      message: "🟡 Вход",
      category: "trades",
      link: "https://binance.example.test/experiments/S98",
    });
    const exit = await log.notify({
      level: "info",
      event: "live.exit",
      message: "🟢 +$0,84",
      category: "trades",
      urgent: true,
      thread: {
        ref: entry.ref,
        label: "сообщение о входе",
        reply: true,
        append: "Итог: 🟢 +$0,84 (TP)",
        mark: "good",
      },
    });
    expect(methods).toEqual([
      "sendMessage",
      "sendMessage",
      "editMessageText",
      "setMessageReaction",
    ]);
    expect(bodies.slice(1)).toEqual([
      {
        chat_id: "-1001234",
        message_thread_id: 12,
        text: "🟢 +$0,84",
        reply_parameters: {
          message_id: 101,
          allow_sending_without_reply: true,
        },
        link_preview_options: { is_disabled: true },
      },
      {
        chat_id: "-1001234",
        message_id: 101,
        text: "🟡 Вход\nhttps://binance.example.test/experiments/S98\nИтог: 🟢 +$0,84 (TP)",
        link_preview_options: { is_disabled: true },
      },
      {
        chat_id: "-1001234",
        message_id: 101,
        reaction: [{ type: "emoji", emoji: "👍" }],
      },
    ]);
    expect(exit.channels[0]).toMatchObject({
      status: "sent",
      reply: "ответ на сообщение о входе",
      amend: "дописано, отметка 👍",
    });
  });

  it("темы не настроены — всё в TELEGRAM_CHAT_ID без темы, но рутина — тихо (сценарий 5)", async () => {
    await log.notify({
      level: "info",
      event: "live.entry",
      message: "🟢 Реальная сделка",
      category: "trades",
    });
    expect(bodies).toEqual([
      {
        chat_id: "-1001234",
        text: "🟢 Реальная сделка",
        disable_notification: true,
        link_preview_options: { is_disabled: true },
      },
    ]);
  });

  it("локальная прод-сборка (APP_HOST не vm) — Bot API не вызывается (ревью PR #105)", async () => {
    vi.stubEnv("APP_HOST", "");
    const r = await log.notify({
      level: "info",
      event: "engine.toggle",
      message: "Автоторговля включена",
      category: "lab",
    });
    expect(bodies).toEqual([]);
    expect(r).toMatchObject({
      status: "skipped",
      reason: "не прод-сервер: production-сборка вне VM (APP_HOST ≠ vm)",
    });
  });

  it("не production — Bot API не вызывается, итог «не production» с темой и звуком (сценарий 6)", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("TELEGRAM_TOPIC_LAB", "14");
    const r = await log.notify({
      level: "info",
      event: "engine.toggle",
      message: "Автоторговля выключена (вход выключен)",
      category: "lab",
    });
    expect(bodies).toEqual([]);
    expect(r).toMatchObject({
      status: "skipped",
      reason: "не production",
      channels: [
        {
          target: { topic: "🧪 Лаборатория", topicId: 14, silent: true },
        },
      ],
    });
  });
});
