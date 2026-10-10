import { z } from "zod";

/** Ответ Auth.js `/api/auth/session`: null — не вошли. */
export const sessionSchema = z
  .object({
    user: z.object({
      login: z.string().nullable().optional(),
      name: z.string().nullable().optional(),
      image: z.string().nullable().optional(),
    }),
  })
  .nullable();
export type AuthSession = z.infer<typeof sessionSchema>;
