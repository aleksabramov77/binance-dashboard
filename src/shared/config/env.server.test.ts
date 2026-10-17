import { describe, expect, it } from "vitest";
import {
  getAccountKeyFixture,
  getAppHost,
  getDatabaseConfig,
  getDeploymentVersion,
  getGithubAlertsConfig,
  getLiveAppUrl,
  getLiveSilentAfterMs,
  getLiveTradeCredentials,
  getLiveWorkerSecret,
  getSiteUrl,
  getTelegramConfig,
  getTelegramTopicId,
  isPrivateChatId,
  isServerless,
  telegramOwnerProblem,
} from "./env.server";

const URL =
  "postgresql://u:p@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres";

describe("isServerless", () => {
  it("true только при VERCEL=1", () => {
    expect(isServerless({ VERCEL: "1" })).toBe(true);
    expect(isServerless({})).toBe(false);
    expect(isServerless({ VERCEL: "" })).toBe(false);
  });
});

describe("getAppHost", () => {
  it("vercel при VERCEL=1, vm при APP_HOST=vm, иначе local", () => {
    expect(getAppHost({ VERCEL: "1" })).toBe("vercel");
    expect(getAppHost({ APP_HOST: "vm" })).toBe("vm");
    expect(getAppHost({ APP_HOST: " vm " })).toBe("vm");
    expect(getAppHost({})).toBe("local");
    expect(getAppHost({ APP_HOST: "mac" })).toBe("local");
  });
});

describe("getDeploymentVersion", () => {
  it("id деплоя Vercel; NEXT_DEPLOYMENT_ID — в приоритете", () => {
    expect(getDeploymentVersion({ VERCEL_DEPLOYMENT_ID: "dpl_1" })).toBe(
      "dpl_1",
    );
    expect(
      getDeploymentVersion({
        NEXT_DEPLOYMENT_ID: "dpl_2",
        VERCEL_DEPLOYMENT_ID: "dpl_1",
      }),
    ).toBe("dpl_2");
  });

  it("не задана или пустая — null", () => {
    expect(getDeploymentVersion({})).toBeNull();
    expect(
      getDeploymentVersion({
        NEXT_DEPLOYMENT_ID: "",
        VERCEL_DEPLOYMENT_ID: " ",
      }),
    ).toBeNull();
  });
});

describe("getDatabaseConfig", () => {
  it("файл SQLite из DATABASE_PATH; DATABASE_URL не читается", () => {
    expect(
      getDatabaseConfig({
        DATABASE_PATH: " /var/lib/binance/app.db ",
        DATABASE_URL: URL,
      }),
    ).toEqual({ kind: "sqlite", path: "/var/lib/binance/app.db" });
  });

  it("без DATABASE_PATH — data/app.db", () => {
    expect(getDatabaseConfig({})).toEqual({
      kind: "sqlite",
      path: "data/app.db",
    });
    expect(
      getDatabaseConfig({ DATABASE_PATH: " ", DATABASE_URL: URL }),
    ).toEqual({ kind: "sqlite", path: "data/app.db" });
  });

  it("на VM без DATABASE_PATH — ошибка, а не data/app.db в каталоге кода", () => {
    expect(() => getDatabaseConfig({ APP_HOST: "vm" })).toThrow(
      /DATABASE_PATH/,
    );
    expect(
      getDatabaseConfig({
        APP_HOST: "vm",
        DATABASE_PATH: "/var/lib/binance/app.db",
      }),
    ).toEqual({ kind: "sqlite", path: "/var/lib/binance/app.db" });
  });

  it("на Vercel — понятная ошибка: файлу базы там негде жить", () => {
    expect(() => getDatabaseConfig({ VERCEL: "1" })).toThrow(/SQLite/);
  });
});

describe("getTelegramConfig", () => {
  it("секрет webhook — необязательный", () => {
    expect(getTelegramConfig({ TELEGRAM_BOT_TOKEN: "t" })).toEqual({
      token: "t",
      chatId: null,
      ownerId: null,
      invalidOwnerId: null,
      webhookSecret: null,
    });
    expect(
      getTelegramConfig({
        TELEGRAM_BOT_TOKEN: "t",
        TELEGRAM_CHAT_ID: "42",
        TELEGRAM_WEBHOOK_SECRET: "s",
      }),
    ).toEqual({
      token: "t",
      chatId: "42",
      ownerId: "42",
      invalidOwnerId: null,
      webhookSecret: "s",
    });
    expect(getTelegramConfig({ TELEGRAM_WEBHOOK_SECRET: "s" })).toBeNull();
  });

  it("владелец (spec 0067): TELEGRAM_OWNER_ID, иначе личный TELEGRAM_CHAT_ID; у группы без него — никто", () => {
    const bot = { TELEGRAM_BOT_TOKEN: "t" };
    expect(
      getTelegramConfig({
        ...bot,
        TELEGRAM_CHAT_ID: "-1001234",
        TELEGRAM_OWNER_ID: " 42 ",
      })?.ownerId,
    ).toBe("42");
    expect(
      getTelegramConfig({ ...bot, TELEGRAM_CHAT_ID: "-1001234" })?.ownerId,
    ).toBeNull();
    expect(getTelegramConfig({ ...bot, TELEGRAM_CHAT_ID: "42" })?.ownerId).toBe(
      "42",
    );
  });

  it("TELEGRAM_OWNER_ID — только положительный id; id группы или мусор — игнорируется с причиной (ревью PR #105)", () => {
    const bot = { TELEGRAM_BOT_TOKEN: "t" };
    const groupOwner = getTelegramConfig({
      ...bot,
      TELEGRAM_CHAT_ID: "-1001234",
      TELEGRAM_OWNER_ID: "-1001234",
    });
    expect(groupOwner).toMatchObject({
      ownerId: null,
      invalidOwnerId: "-1001234",
    });
    expect(groupOwner && telegramOwnerProblem(groupOwner)).toMatch(
      /^TELEGRAM_OWNER_ID \(-1001234\) — не id пользователя.*владелец — не задан\.$/,
    );
    // Личный TELEGRAM_CHAT_ID остаётся владельцем по умолчанию.
    expect(
      getTelegramConfig({
        ...bot,
        TELEGRAM_CHAT_ID: "42",
        TELEGRAM_OWNER_ID: "@owner",
      }),
    ).toMatchObject({ ownerId: "42", invalidOwnerId: "@owner" });
    const ok = getTelegramConfig({ ...bot, TELEGRAM_OWNER_ID: "42" });
    expect(ok && telegramOwnerProblem(ok)).toBeNull();
  });

  it("личный чат — положительный id", () => {
    expect(isPrivateChatId("42")).toBe(true);
    expect(isPrivateChatId("-1001234")).toBe(false);
    expect(isPrivateChatId("0")).toBe(false);
    expect(isPrivateChatId(null)).toBe(false);
  });
});

describe("getTelegramTopicId (spec 0067)", () => {
  it("целое > 0 — номер темы; не задана или мусор — null (сообщение без темы)", () => {
    expect(
      getTelegramTopicId("TELEGRAM_TOPIC_LAB", { TELEGRAM_TOPIC_LAB: " 12 " }),
    ).toBe(12);
    expect(getTelegramTopicId("TELEGRAM_TOPIC_LAB", {})).toBeNull();
    expect(
      getTelegramTopicId("TELEGRAM_TOPIC_LAB", { TELEGRAM_TOPIC_LAB: "" }),
    ).toBeNull();
    expect(
      getTelegramTopicId("TELEGRAM_TOPIC_LAB", { TELEGRAM_TOPIC_LAB: "abc" }),
    ).toBeNull();
    expect(
      getTelegramTopicId("TELEGRAM_TOPIC_LAB", { TELEGRAM_TOPIC_LAB: "-3" }),
    ).toBeNull();
    expect(
      getTelegramTopicId("TELEGRAM_TOPIC_LAB", { TELEGRAM_TOPIC_LAB: "1.5" }),
    ).toBeNull();
  });
});

describe("getGithubAlertsConfig", () => {
  it("без GITHUB_ALERTS_TOKEN — null: монитор только с Telegram", () => {
    expect(getGithubAlertsConfig({})).toBeNull();
    expect(getGithubAlertsConfig({ GITHUB_ALERTS_TOKEN: " " })).toBeNull();
  });

  it("по умолчанию — приватный репозиторий и 3 автозапуска в сутки", () => {
    expect(getGithubAlertsConfig({ GITHUB_ALERTS_TOKEN: "t" })).toEqual({
      token: "t",
      owner: "aleksabramov77",
      repo: "binance-dashboard-private",
      autofixPerDay: 3,
      invalid: [],
    });
  });

  it("берёт GITHUB_ALERTS_REPO и ALERT_AUTOFIX_PER_DAY; мусор — по умолчанию и в invalid", () => {
    expect(
      getGithubAlertsConfig({
        GITHUB_ALERTS_TOKEN: "t",
        GITHUB_ALERTS_REPO: "me/alerts",
        ALERT_AUTOFIX_PER_DAY: "0",
      }),
    ).toMatchObject({ owner: "me", repo: "alerts", autofixPerDay: 0 });
    expect(
      getGithubAlertsConfig({
        GITHUB_ALERTS_TOKEN: "t",
        GITHUB_ALERTS_REPO: "no-slash",
        ALERT_AUTOFIX_PER_DAY: "-1",
      }),
    ).toMatchObject({
      repo: "binance-dashboard-private",
      autofixPerDay: 3,
      invalid: ["GITHUB_ALERTS_REPO", "ALERT_AUTOFIX_PER_DAY"],
    });
  });
});

describe("реальный счёт (spec 0047)", () => {
  it("торговый ключ — только когда заданы оба значения", () => {
    expect(getLiveTradeCredentials({})).toBeNull();
    expect(getLiveTradeCredentials({ BINANCE_TRADE_API_KEY: "k" })).toBeNull();
    expect(
      getLiveTradeCredentials({
        BINANCE_TRADE_API_KEY: " k ",
        BINANCE_TRADE_API_SECRET: "s",
      }),
    ).toEqual({ live: { apiKey: "k", apiSecret: "s" } });
  });

  it("секрет пульса и адрес приложения: пусто — null, «/» в конце убирается", () => {
    expect(getLiveWorkerSecret({ LIVE_WORKER_SECRET: " " })).toBeNull();
    expect(getLiveWorkerSecret({ LIVE_WORKER_SECRET: "x" })).toBe("x");
    expect(getLiveAppUrl({})).toBeNull();
    expect(getLiveAppUrl({ LIVE_APP_URL: "http://localhost:5003/" })).toBe(
      "http://localhost:5003",
    );
  });

  it("порог «молчит»: 5 мин по умолчанию, LIVE_SILENT_AFTER_SEC — в секундах, мусор — по умолчанию", () => {
    expect(getLiveSilentAfterMs({})).toBe(300_000);
    expect(getLiveSilentAfterMs({ LIVE_SILENT_AFTER_SEC: "60" })).toBe(60_000);
    expect(getLiveSilentAfterMs({ LIVE_SILENT_AFTER_SEC: "abc" })).toBe(
      300_000,
    );
    expect(getLiveSilentAfterMs({ LIVE_SILENT_AFTER_SEC: "-5" })).toBe(300_000);
  });
});

describe("getSiteUrl", () => {
  it("адрес из SITE_URL без завершающего /; без него — null, не старый адрес Vercel", () => {
    expect(getSiteUrl({})).toBeNull();
    expect(getSiteUrl({ SITE_URL: "  " })).toBeNull();
    expect(getSiteUrl({ SITE_URL: "https://binance.example.test/" })).toBe(
      "https://binance.example.test",
    );
  });
});

describe("getAccountKeyFixture (spec 0065)", () => {
  const dev = { NODE_ENV: "development", ACCOUNT_KEY_FIXTURE: "read-only" };

  it("локально в dev — заданная заглушка", () => {
    expect(getAccountKeyFixture(dev)).toBe("read-only");
    expect(
      getAccountKeyFixture({ ...dev, ACCOUNT_KEY_FIXTURE: " trading " }),
    ).toBe("trading");
    expect(
      getAccountKeyFixture({ ...dev, ACCOUNT_KEY_FIXTURE: "rejected" }),
    ).toBe("rejected");
  });

  it("на VM, на Vercel и в production — всегда null", () => {
    expect(getAccountKeyFixture({ ...dev, APP_HOST: "vm" })).toBeNull();
    expect(getAccountKeyFixture({ ...dev, VERCEL: "1" })).toBeNull();
    expect(getAccountKeyFixture({ ...dev, NODE_ENV: "production" })).toBeNull();
  });

  it("не задана или неизвестное значение — null", () => {
    expect(getAccountKeyFixture({ NODE_ENV: "development" })).toBeNull();
    expect(
      getAccountKeyFixture({ ...dev, ACCOUNT_KEY_FIXTURE: "ok" }),
    ).toBeNull();
  });
});
