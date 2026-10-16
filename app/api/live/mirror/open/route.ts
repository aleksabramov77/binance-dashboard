import { saveLiveOpen } from "@/app/server/liveMirror";
import { liveWorkerPost } from "@/app/server/liveWorkerRoute";
import { liveOpenRequestSchema } from "@/entities/experiment";

// Итог реального входа (spec 0049): строка, журнал live.entry/live.unprotected, Telegram.
export const POST = liveWorkerPost(
  "live.mirror.open",
  liveOpenRequestSchema,
  async (b) => {
    await saveLiveOpen(b);
    return { ok: true };
  },
);
