import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { type TradeResult, tradeResultSchema } from "@/entities/trade";

const LOG_FILE = path.join(process.cwd(), "data", "trades", "demo.jsonl");

export async function appendTrade(trade: TradeResult): Promise<void> {
  await mkdir(path.dirname(LOG_FILE), { recursive: true });
  await appendFile(LOG_FILE, `${JSON.stringify(trade)}\n`);
}

/** Последние сделки, новые сверху. */
export async function readRecentTrades(limit = 20): Promise<TradeResult[]> {
  let raw: string;
  try {
    raw = await readFile(LOG_FILE, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return raw
    .split("\n")
    .filter(Boolean)
    .slice(-limit)
    .reverse()
    .flatMap((line) => {
      const parsed = tradeResultSchema.safeParse(JSON.parse(line));
      return parsed.success ? [parsed.data] : [];
    });
}
