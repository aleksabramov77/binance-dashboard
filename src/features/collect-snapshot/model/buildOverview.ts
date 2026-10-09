import { diffSnapshots, type EarnOverview } from "@/entities/earn-offer";
import { listSnapshotFiles, readSnapshot } from "../api/snapshotStore";

/** Сколько последних снимков сравниваем для ленты изменений. */
const HISTORY_DEPTH = 30;

export async function buildOverview(): Promise<EarnOverview> {
  const files = await listSnapshotFiles();
  const recent = await Promise.all(
    files.slice(-HISTORY_DEPTH).map(readSnapshot),
  );
  const changes = recent
    .slice(1)
    .flatMap((snapshot, i) => diffSnapshots(recent[i], snapshot));
  changes.reverse();
  return {
    latest: recent.at(-1) ?? null,
    changes,
    snapshotCount: files.length,
  };
}
