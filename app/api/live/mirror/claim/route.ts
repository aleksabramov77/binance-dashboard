import { claimLive } from "@/app/server/liveMirror";
import { liveWorkerPost } from "@/app/server/liveWorkerRoute";
import { liveTradeIdSchema } from "@/entities/experiment";

// Захват сделки перед реальным входом (spec 0049): стоп входов читается здесь, перед каждым входом.
export const POST = liveWorkerPost(
  "live.mirror.claim",
  liveTradeIdSchema,
  (b) => claimLive(b.tradeId),
);
