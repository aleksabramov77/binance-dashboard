import { claimLiveClose } from "@/app/server/liveMirror";
import { liveWorkerPost } from "@/app/server/liveWorkerRoute";
import { liveTradeIdSchema } from "@/entities/experiment";

// Захват реальной позиции на закрытие (paper-сделка закрылась), spec 0049.
export const POST = liveWorkerPost(
  "live.mirror.claim_close",
  liveTradeIdSchema,
  async (b) => ({ item: await claimLiveClose(b.tradeId) }),
);
