import { diffSnapshots, type EarnOverview } from "@/entities/earn-offer";
import { countSnapshots, listRecentSnapshots } from "../api/snapshotStore";

/** Сколько последних снимков сравниваем для ленты изменений. */
const HISTORY_DEPTH = 30;

export async function buildOverview(): Promise<EarnOverview> {
  const [recent, snapshotCount] = await Promise.all([
    listRecentSnapshots(HISTORY_DEPTH),
    countSnapshots(),
  ]);
  const changes = recent
    .slice(1)
    .flatMap((snapshot, i) => diffSnapshots(recent[i], snapshot));
  changes.reverse();
  return { latest: recent.at(-1) ?? null, changes, snapshotCount };
}
