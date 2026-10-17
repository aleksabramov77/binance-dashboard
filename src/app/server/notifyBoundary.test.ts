import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Все уведомления — через логгер (spec 0067, AC4): новый код не шлёт в Telegram мимо log.notify. sendTelegramMessage
// вызывают только Telegram-канал и бот (ответы на команды — не уведомления); Bot API напрямую — только клиент.
const ROOT = path.resolve(import.meta.dirname, "../../..");
const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  ".git",
  ".claude",
  "dist",
  "data",
  "private",
  "storybook-static",
  "supabase",
]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory())
      return SKIP_DIRS.has(e.name) ? [] : sourceFiles(path.join(dir, e.name));
    return /\.(ts|tsx|mts)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)
      ? [path.relative(ROOT, path.join(dir, e.name))]
      : [];
  });
}

const using = (pattern: RegExp) =>
  sourceFiles(ROOT)
    .filter((file) => pattern.test(readFileSync(path.join(ROOT, file), "utf8")))
    .sort();

describe("уведомления — только через логгер", () => {
  it("sendTelegramMessage — только Telegram-канал и бот", () => {
    expect(using(/\bsendTelegramMessage\b/)).toEqual([
      "src/app/server/telegramBot.ts",
      "src/shared/api/telegram/channel.server.ts",
      "src/shared/api/telegram/client.server.ts",
      "src/shared/api/telegram/index.ts",
    ]);
  });

  it("удаление и правка сообщений (spec 0068) — только Telegram-канал", () => {
    expect(
      using(/\b(editTelegramMessageText|deleteTelegramMessage)\b/),
    ).toEqual([
      "src/shared/api/telegram/channel.server.ts",
      "src/shared/api/telegram/client.server.ts",
      "src/shared/api/telegram/index.ts",
    ]);
  });

  it("Bot API напрямую — только клиент (и getUpdates для chat id в monitor:supabase)", () => {
    expect(using(/api\.telegram\.org/)).toEqual([
      "scripts/monitor-supabase.ts",
      "src/shared/api/telegram/client.server.ts",
    ]);
  });
});
