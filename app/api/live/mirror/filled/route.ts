import { saveLiveFilled } from "@/app/server/liveMirror";
import { liveWorkerPost } from "@/app/server/liveWorkerRoute";
import { liveFilledRequestSchema } from "@/entities/experiment";

// Вход исполнен, защита ещё ставится (spec 0068, B1): карточка сделки ⏳.
export const POST = liveWorkerPost(
  "live.mirror.filled",
  liveFilledRequestSchema,
  async (b) => {
    await saveLiveFilled(b);
    return { ok: true };
  },
);
