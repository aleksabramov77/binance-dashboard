import { liveCloseAll } from "@/app/server/liveMirror";
import { liveWorkerPost } from "@/app/server/liveWorkerRoute";
import { liveCloseAllRequestSchema } from "@/entities/experiment";

// «Закрыть всё» (spec 0049): захват всех открытых реальных позиций (claim) и итог воркера (done).
export const POST = liveWorkerPost(
  "live.mirror.close_all",
  liveCloseAllRequestSchema,
  async (b) => {
    const items = await liveCloseAll(b);
    return b.phase === "claim" ? { items } : { ok: true };
  },
);
