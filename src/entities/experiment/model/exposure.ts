import { z } from "zod";

// Что остаётся без присмотра, если выключить «Автоторговлю» (spec 0044): GET /api/experiments/engine/exposure.
// Отдельно от model/engine.ts — тот грузит Edge Function engine-tick.

export const engineExposureSchema = z.object({
  /** Открытые paper-сделки (paper_trades без closed_at). */
  openPaper: z.number().int().nonnegative(),
  /** Демо-позиции зеркала в активных статусах (ACTIVE_MIRROR_STATUSES). */
  openDemo: z.number().int().nonnegative(),
});

export type EngineExposure = z.infer<typeof engineExposureSchema>;
