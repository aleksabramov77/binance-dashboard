import { type EarnOverview, earnOverviewSchema } from "../model/schema";

export async function getEarnOverview(): Promise<EarnOverview> {
  const res = await fetch("/api/earn", { cache: "no-store" });
  if (!res.ok) throw new Error(`Не удалось загрузить данные (${res.status})`);
  return earnOverviewSchema.parse(await res.json());
}
