import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { type Snapshot, snapshotSchema } from "@/entities/earn-offer";

const SNAPSHOT_DIR =
  process.env.EARN_DATA_DIR ?? path.join(process.cwd(), "data", "snapshots");

const fileNameFor = (fetchedAt: string) =>
  `${fetchedAt.replaceAll(":", "-")}.json`;

export async function saveSnapshot(snapshot: Snapshot): Promise<string> {
  await mkdir(SNAPSHOT_DIR, { recursive: true });
  const file = path.join(SNAPSHOT_DIR, fileNameFor(snapshot.fetchedAt));
  await writeFile(file, JSON.stringify(snapshot));
  return file;
}

/** Имена файлов снимков, от старых к новым (ISO-имена сортируются лексикографически). */
export async function listSnapshotFiles(): Promise<string[]> {
  try {
    const files = await readdir(SNAPSHOT_DIR);
    return files.filter((f) => f.endsWith(".json")).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function readSnapshot(fileName: string): Promise<Snapshot> {
  const raw = await readFile(path.join(SNAPSHOT_DIR, fileName), "utf8");
  return snapshotSchema.parse(JSON.parse(raw));
}
