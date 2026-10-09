import { z } from "zod";

export const aiCreditsSchema = z.discriminatedUnion("configured", [
  z.object({ configured: z.literal(false) }),
  z.object({
    configured: z.literal(true),
    balanceUsd: z.number(),
    totalCreditsUsd: z.number(),
    totalUsageUsd: z.number(),
    keyLimitUsd: z.number().nullable(),
    keyRemainingUsd: z.number().nullable(),
    keyUsageUsd: z.number(),
  }),
]);

export type AiCredits = z.infer<typeof aiCreditsSchema>;
