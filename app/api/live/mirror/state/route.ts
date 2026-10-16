import { z } from "zod";
import { liveMirrorState } from "@/app/server/liveMirror";
import { liveWorkerPost } from "@/app/server/liveWorkerRoute";

// Состояние прогона реального зеркала для воркера (spec 0049): стоп, кандидаты, позиции, дневной PnL, закрытия.
export const POST = liveWorkerPost(
  "live.mirror.state",
  z.object({}).loose(),
  () => liveMirrorState(),
);
