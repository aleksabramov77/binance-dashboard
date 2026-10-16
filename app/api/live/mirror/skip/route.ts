import { skipLive } from "@/app/server/liveMirror";
import { liveWorkerPost } from "@/app/server/liveWorkerRoute";
import { liveSkipRequestSchema } from "@/entities/experiment";

// Пропуск реального входа с причиной (spec 0049): лимиты, стоп, монета, свежесть.
export const POST = liveWorkerPost(
  "live.mirror.skip",
  liveSkipRequestSchema,
  async (b) => {
    await skipLive(b.tradeId, b.reason);
    return { ok: true };
  },
);
