import { saveLiveLegs } from "@/app/server/liveMirror";
import { liveWorkerPost } from "@/app/server/liveWorkerRoute";
import { liveLegsRequestSchema } from "@/entities/experiment";

// Сверка ног реальных фьючерсов: сработал TP/SL на бирже — позиция закрыта, вторая нога снята (spec 0049).
export const POST = liveWorkerPost(
  "live.mirror.legs",
  liveLegsRequestSchema,
  async (b) => {
    await saveLiveLegs(b);
    return { ok: true };
  },
);
