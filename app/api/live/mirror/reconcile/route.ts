import { saveLiveReconcile } from "@/app/server/liveMirror";
import { liveWorkerPost } from "@/app/server/liveWorkerRoute";
import { liveReconcileRequestSchema } from "@/entities/experiment";

// Итог сверки «потерянного» входа с биржей по своему clientOrderId (spec 0049).
export const POST = liveWorkerPost(
  "live.mirror.reconcile",
  liveReconcileRequestSchema,
  async (b) => {
    await saveLiveReconcile(b);
    return { ok: true };
  },
);
