import { z } from "zod";

/** Ответ `/api/auth/session`, когда вход локально не настроен (Auth.js не создан). */
export const AUTH_DISABLED_RESPONSE = { authDisabled: true } as const;

const userSchema = z.object({
  login: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  image: z.string().nullable().optional(),
});

/** Ответ Auth.js `/api/auth/session`: null или {} — не вошли. */
const sessionResponseSchema = z.union([
  z.object({ authDisabled: z.literal(true) }),
  z.object({ user: userSchema }),
  z.object({}).strict(),
  z.null(),
]);

export type AuthUser = z.infer<typeof userSchema>;
export type AuthState =
  | { status: "disabled" }
  | { status: "signed-out" }
  | { status: "signed-in"; user: AuthUser };

export function toAuthState(json: unknown): AuthState {
  const data = sessionResponseSchema.parse(json);
  if (data && "authDisabled" in data) return { status: "disabled" };
  if (data && "user" in data) return { status: "signed-in", user: data.user };
  return { status: "signed-out" };
}
