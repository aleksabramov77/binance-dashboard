import { saveLiveClose } from "@/app/server/liveMirror";
import { liveWorkerPost } from "@/app/server/liveWorkerRoute";
import { liveCloseRequestSchema } from "@/entities/experiment";

// Итог закрытия реальной позиции с PnL по исполнениям (spec 0049).
export const POST = liveWorkerPost(
  "live.mirror.close",
  liveCloseRequestSchema,
  async (b) => {
    await saveLiveClose(b);
    return { ok: true };
  },
);
